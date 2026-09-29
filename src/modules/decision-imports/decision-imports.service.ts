import {
  ApplicationStatus,
  DecisionImportStatus,
  Criterion,
  EventStatus,
  EvidenceSourceType,
  EvidenceStatus,
  FileStorageType,
  IndexingStatus,
  JobStatus,
  JobType,
  Level,
  Prisma,
  Role,
  ReviewTaskStatus,
  RosterPreviewValidationStatus,
} from '@prisma/client';
import type { IndexingJob, SmartReaderJob } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../infrastructure/database/prisma';
import { auditActions } from '../../shared/constants/application';
import {
  buildOfficialMatchingStatus,
  buildReadableSummary,
  getEvidenceStudentStatus,
  mapWarnings,
} from '../../shared/dto/evidence-student-status';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import {
  assertSameWorkspace,
  workspaceFilterFor,
  workspaceIdForWrite,
} from '../../shared/utils/workspace-scope';
import { canStudentAccessCityEvent } from '../event-registry/event-registry.scope';
import { AuditService } from '../audit/audit.service';
import { assertApplicationEditable, assertApplicationOwner, createApplicationAudit } from '../applications/application.helpers';
import { evidenceCardConfirmationStatuses } from '../evidences/evidence-card-confirmation';
import {
  normalizeMatchingText,
  resolveExactParticipantNameMatch,
} from '../event-registry/event-participant-matching';
import { runIndexingJob } from '../jobs/jobs.service';
import { StorageService } from '../storage/storage.service';
import { sanitizeFileName } from '../storage/storage.types';
import { mapDecisionImportUxStatus } from './decision-import-ux-status.mapper';
import { normalizeDecisionTables, type NormalizedDecisionTable } from './decision-ocr-table-normalizer';
import { DecisionImportsRepository, decisionImportInclude } from './decision-imports.repository';
import type {
  ConfirmDecisionImportInput,
  CreateDecisionImportInput,
  ListDecisionImportsQuery,
  StartDecisionImportInput,
  UpdateDecisionRosterCorrectionInput,
  UpdateColumnMappingInput,
} from './decision-imports.validation';
import { detectDecisionTableType } from './roster-table.detector';
import { suggestRosterColumnMapping, type DecisionColumnMapping } from './roster-column-mapping.service';
import { markDuplicateRows, normalizeRosterRow, type NormalizedRosterPreviewRow } from './roster-row.normalizer';
import {
  applyDecisionRosterCorrections,
  decisionRosterCorrectionKey,
  readDecisionRosterCorrections,
  type DecisionRosterCorrections,
} from './decision-roster-corrections';

type DecisionImportRecord = Prisma.DecisionImportGetPayload<{ include: typeof decisionImportInclude }>;
type DecisionImportListRecord = Prisma.DecisionImportGetPayload<{
  include: {
    sourceFile: true;
    documents: true;
    _count: { select: { previewRows: true; tables: true } };
  };
}>;
type UploadedDecisionFile = Express.Multer.File;

const auditService = new AuditService();
const storageService = new StorageService();

export class DecisionImportsService {
  constructor(private readonly repository = new DecisionImportsRepository()) {}

  async list(user: AuthenticatedUser, query: ListDecisionImportsQuery) {
    const { items, total } = await this.repository.list(user, query);
    return {
      items: await this.toListDtos(items),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async create(user: AuthenticatedUser, input: CreateDecisionImportInput) {
    const created = await prisma.decisionImport.create({
      data: {
        title: input.title,
        criterion: input.criterion,
        eventName: input.eventName,
        organizer: input.organizer,
        organizerLevel: input.organizerLevel,
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
        convertedValue: input.convertedValue,
        convertedUnit: input.convertedUnit,
        eligibleLevelsJson: input.eligibleLevels ?? undefined,
        workspaceId: workspaceIdForWrite(user),
        createdBy: user.id,
      },
    });

    await auditService.log({
      actorId: user.id,
      actorRole: user.role,
      action: auditActions.DECISION_IMPORT_CREATED,
      entityType: 'decision_import',
      entityId: created.id,
      decisionImportId: created.id,
      after: { title: created.title, status: created.status },
    });

    return this.getDetail(user, created.id);
  }

  async getDetail(user: AuthenticatedUser, id: string) {
    const record = await this.getRequiredImport(id, user);
    return this.toDetailDto(record);
  }

  async uploadFile(user: AuthenticatedUser, id: string, file?: UploadedDecisionFile) {
    const record = await this.getRequiredImport(id, user);
    assertDecisionImportMutable(record, 'Cannot replace file after confirmation or cancellation');
    if (!file) throw new AppError(400, ErrorCodes.EVIDENCE_FILE_REQUIRED, 'Decision document file is required');
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      throw new AppError(400, ErrorCodes.FILE_TYPE_NOT_ALLOWED, 'Decision import supports PDF and image files only');
    }

    const safeName = sanitizeFileName(file.originalname);
    const key = `decision-imports/${record.id}/${Date.now()}-${safeName}`;
    await storageService.uploadObject({ key, buffer: file.buffer, contentType: file.mimetype });
    try {
      await prisma.$transaction(async (tx) => {
        await lockDecisionImport(tx, record.id);
        const current = await tx.decisionImport.findUnique({ where: { id: record.id } });
        if (!current) throw new AppError(404, ErrorCodes.NOT_FOUND, 'Decision import not found');
        assertSameWorkspace(user, current, 'Decision import not found');
        assertDecisionImportMutable(current, 'Cannot replace file after confirmation or cancellation');

        const fileRecord = await tx.file.create({
          data: {
            ownerId: user.id,
            storageType: env.STORAGE_DRIVER === 'r2' ? FileStorageType.r2 : FileStorageType.local,
            filePath: key,
            originalName: file.originalname,
            mimeType: file.mimetype,
            fileSize: file.size,
            workspaceId: current.workspaceId,
            uploadedBy: user.id,
          },
        });
        await tx.decisionTable.deleteMany({ where: { decisionImportId: record.id } });
        await tx.decisionRosterPreviewRow.deleteMany({ where: { decisionImportId: record.id } });
        await tx.decisionDocument.deleteMany({ where: { decisionImportId: record.id } });
        await tx.decisionImport.update({
          where: { id: record.id },
          data: {
            sourceFileId: fileRecord.id,
            vnptHash: null,
            vnptFileType: null,
            metadataJobId: null,
            rosterJobId: null,
            columnMappingJson: Prisma.DbNull,
            status: DecisionImportStatus.uploaded,
            lastErrorCode: null,
            lastErrorMessage: null,
            lastUserMessage: null,
            processingStep: 'source_file_uploaded',
          },
        });
        await auditService.log({
          tx,
          actorId: user.id,
          actorRole: user.role,
          action: auditActions.DECISION_IMPORT_FILE_UPLOADED,
          entityType: 'decision_import',
          entityId: record.id,
          decisionImportId: record.id,
          metadata: { fileId: fileRecord.id, mimeType: file.mimetype, size: file.size },
        });
      });
    } catch (error) {
      await storageService.deleteObject(key, env.STORAGE_DRIVER).catch(() => undefined);
      throw error;
    }

    return this.getDetail(user, record.id);
  }

  async start(user: AuthenticatedUser, id: string, input: StartDecisionImportInput) {
    const record = await this.getRequiredImport(id, user);
    if (!record.sourceFileId) throw new AppError(400, ErrorCodes.EVIDENCE_FILE_REQUIRED, 'Upload a decision file before starting import');
    assertDecisionImportMutable(record, 'Decision import cannot be processed after confirmation or cancellation');

    const result = await prisma.$transaction(async (tx) => {
      await lockDecisionImport(tx, record.id);
      const current = await tx.decisionImport.findUnique({ where: { id: record.id } });
      if (!current) throw new AppError(404, ErrorCodes.NOT_FOUND, 'Decision import not found');
      assertSameWorkspace(user, current, 'Decision import not found');
      if (!current.sourceFileId) throw new AppError(400, ErrorCodes.EVIDENCE_FILE_REQUIRED, 'Upload a decision file before starting import');
      assertDecisionImportMutable(current, 'Decision import cannot be processed after confirmation or cancellation');

      const metadataJob = await findOrCreateDecisionJob(
        tx,
        current.id,
        JobType.decision_metadata,
        current.workspaceId,
      );
      const rosterJob = await findOrCreateDecisionJob(
        tx,
        current.id,
        JobType.decision_roster_ocr,
        current.workspaceId,
      );
      await tx.decisionTable.deleteMany({ where: { decisionImportId: current.id } });
      await tx.decisionRosterPreviewRow.deleteMany({ where: { decisionImportId: current.id } });
      const updated = await tx.decisionImport.update({
        where: { id: current.id },
        data: {
          metadataJobId: metadataJob.id,
          rosterJobId: rosterJob.id,
          status: DecisionImportStatus.extracting_metadata,
          processingStep: 'metadata_and_roster_jobs_queued',
          lastErrorCode: null,
          lastErrorMessage: null,
          lastUserMessage: null,
        },
      });
      await auditService.log({
        tx,
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.DECISION_IMPORT_STARTED,
        entityType: 'decision_import',
        entityId: current.id,
        decisionImportId: current.id,
        metadata: { metadataJobId: metadataJob.id, rosterJobId: rosterJob.id },
      });
      return { updated, metadataJob, rosterJob };
    });

    if (input.runMode === 'sync') {
      await runIndexingJob(result.metadataJob.id);
      await runIndexingJob(result.rosterJob.id);
    }

    return this.getDetail(user, result.updated.id);
  }

  async status(user: AuthenticatedUser, id: string) {
    const detail = await this.getDetail(user, id);
    return {
      id: detail.id,
      status: detail.status,
      uxStatus: detail.uxStatus,
      jobs: detail.jobs,
      previewSummary: detail.previewSummary,
      lastError: detail.lastError,
    };
  }

  async metadata(user: AuthenticatedUser, id: string) {
    const record = await this.getRequiredImport(id, user);
    return { decisionImportId: id, document: record.documents[0] ?? null };
  }

  async tables(user: AuthenticatedUser, id: string) {
    const record = await this.getRequiredImport(id, user);
    return { decisionImportId: id, items: record.tables };
  }

  async preview(user: AuthenticatedUser, id: string) {
    const record = await this.getRequiredImport(id, user);
    return {
      decisionImportId: id,
      summary: previewSummary(record.previewRows),
      items: record.previewRows,
    };
  }

  async audit(user: AuthenticatedUser, id: string) {
    await this.getRequiredImport(id, user);
    return prisma.auditLog.findMany({
      where: { decisionImportId: id, ...workspaceFilterFor(user) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async updateColumnMapping(user: AuthenticatedUser, id: string, input: UpdateColumnMappingInput) {
    const visibleRecord = await this.getRequiredImport(id, user);
    assertDecisionImportMutable(visibleRecord, 'Cannot update mapping after confirmation or cancellation');
    await prisma.$transaction(async (tx) => {
      await lockDecisionImport(tx, id);
      const record = await tx.decisionImport.findUnique({ where: { id }, include: decisionImportInclude });
      if (!record) throw new AppError(404, ErrorCodes.NOT_FOUND, 'Decision import not found');
      assertSameWorkspace(user, record, 'Decision import not found');
      assertDecisionImportMutable(record, 'Cannot update mapping after confirmation or cancellation');
      const rosterTables = record.tables.filter((table) => table.detectedType === 'roster');
      const baseRows = buildPreviewRowsFromTables({
        tables: rosterTables.map((table) => table.rawTableJson as unknown as NormalizedDecisionTable),
        mapping: input.columnMapping,
        fallbackCriterion: record.criterion,
        fallbackConvertedValue: record.convertedValue,
        fallbackConvertedUnit: record.convertedUnit,
      });
      if (!baseRows.length) {
        throw new AppError(422, ErrorCodes.ROSTER_PARSE_FAILED, 'Column mapping produced no roster rows');
      }
      const rosterJob = record.rosterJobId
        ? await tx.indexingJob.findUnique({ where: { id: record.rosterJobId } })
        : null;
      const corrections = readDecisionRosterCorrections(rosterJob?.resultJson);
      const previewRows = applyDecisionRosterCorrections(baseRows, corrections);

      await tx.decisionRosterPreviewRow.deleteMany({ where: { decisionImportId: id } });
      await createPreviewRows(tx, id, previewRows);
      await tx.decisionImport.update({
        where: { id },
        data: {
          columnMappingJson: input.columnMapping,
          status: DecisionImportStatus.preview_ready,
        },
      });
      await auditService.log({
        tx,
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.DECISION_COLUMN_MAPPING_UPDATED,
        entityType: 'decision_import',
        entityId: id,
        decisionImportId: id,
        metadata: { rowCount: previewRows.length, preservedCorrectionCount: Object.keys(corrections).length },
      });
    });

    return this.preview(user, id);
  }

  async updatePreviewRow(user: AuthenticatedUser, id: string, rowId: string, input: UpdateDecisionRosterCorrectionInput) {
    const visibleRecord = await this.getRequiredImport(id, user);
    assertDecisionImportMutable(visibleRecord, 'Cannot correct rows after confirmation or cancellation');
    await prisma.$transaction(async (tx) => {
      await lockDecisionImport(tx, id);
      const record = await tx.decisionImport.findUnique({ where: { id }, include: decisionImportInclude });
      if (!record) throw new AppError(404, ErrorCodes.NOT_FOUND, 'Decision import not found');
      assertSameWorkspace(user, record, 'Decision import not found');
      assertDecisionImportMutable(record, 'Cannot correct rows after confirmation or cancellation');
      const target = record.previewRows.find((row) => row.id === rowId);
      if (!target) throw new AppError(404, ErrorCodes.NOT_FOUND, 'Decision roster preview row not found');
      const rosterJob = record.rosterJobId
        ? await tx.indexingJob.findUnique({ where: { id: record.rosterJobId } })
        : null;
      if (!rosterJob || rosterJob.status !== JobStatus.completed) {
        throw new AppError(409, ErrorCodes.CONFLICT, 'Current roster extraction is not ready for correction');
      }

      const corrections = readDecisionRosterCorrections(rosterJob.resultJson);
      const key = decisionRosterCorrectionKey(toNormalizedPreviewRow(target));
      const nextCorrections: DecisionRosterCorrections = {
        ...corrections,
        [key]: { ...(corrections[key] ?? {}), ...input },
      };
      const previewRows = rebuildDecisionPreview(record, nextCorrections);
      await tx.decisionRosterPreviewRow.deleteMany({ where: { decisionImportId: id } });
      await createPreviewRows(tx, id, previewRows);
      await tx.indexingJob.update({
        where: { id: rosterJob.id },
        data: { resultJson: withRowCorrections(rosterJob.resultJson, nextCorrections) },
      });
      await auditService.log({
        tx,
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.DECISION_ROSTER_ROW_CORRECTED,
        entityType: 'decision_import',
        entityId: id,
        decisionImportId: id,
        metadata: {
          sourcePage: target.sourcePage,
          sourceTableIndex: target.sourceTableIndex,
          sourceRowIndex: target.sourceRowIndex,
          changedFields: Object.keys(input),
        },
      });
    });
    return this.preview(user, id);
  }

  async revertPreviewRowCorrection(user: AuthenticatedUser, id: string, rowId: string) {
    const visibleRecord = await this.getRequiredImport(id, user);
    assertDecisionImportMutable(visibleRecord, 'Cannot revert rows after confirmation or cancellation');
    await prisma.$transaction(async (tx) => {
      await lockDecisionImport(tx, id);
      const record = await tx.decisionImport.findUnique({ where: { id }, include: decisionImportInclude });
      if (!record) throw new AppError(404, ErrorCodes.NOT_FOUND, 'Decision import not found');
      assertSameWorkspace(user, record, 'Decision import not found');
      assertDecisionImportMutable(record, 'Cannot revert rows after confirmation or cancellation');
      const target = record.previewRows.find((row) => row.id === rowId);
      if (!target) throw new AppError(404, ErrorCodes.NOT_FOUND, 'Decision roster preview row not found');
      if (!record.rosterJobId) throw new AppError(409, ErrorCodes.CONFLICT, 'Current roster extraction is unavailable');
      const rosterJob = await tx.indexingJob.findUnique({ where: { id: record.rosterJobId } });
      if (!rosterJob || rosterJob.status !== JobStatus.completed) {
        throw new AppError(409, ErrorCodes.CONFLICT, 'Current roster extraction is not ready for correction');
      }

      const corrections = readDecisionRosterCorrections(rosterJob.resultJson);
      const key = decisionRosterCorrectionKey(toNormalizedPreviewRow(target));
      const { [key]: removed, ...remainingCorrections } = corrections;
      if (!removed) throw new AppError(409, ErrorCodes.CONFLICT, 'Roster row has no manual correction');
      const previewRows = rebuildDecisionPreview(record, remainingCorrections);
      await tx.decisionRosterPreviewRow.deleteMany({ where: { decisionImportId: id } });
      await createPreviewRows(tx, id, previewRows);
      await tx.indexingJob.update({
        where: { id: rosterJob.id },
        data: { resultJson: withRowCorrections(rosterJob.resultJson, remainingCorrections) },
      });
      await auditService.log({
        tx,
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.DECISION_ROSTER_ROW_CORRECTION_REVERTED,
        entityType: 'decision_import',
        entityId: id,
        decisionImportId: id,
        metadata: {
          sourcePage: target.sourcePage,
          sourceTableIndex: target.sourceTableIndex,
          sourceRowIndex: target.sourceRowIndex,
          revertedFields: Object.keys(removed),
        },
      });
    });
    return this.preview(user, id);
  }

  async cancel(user: AuthenticatedUser, id: string) {
    await this.getRequiredImport(id, user);
    await prisma.$transaction(async (tx) => {
      await lockDecisionImport(tx, id);
      const record = await tx.decisionImport.findUnique({ where: { id } });
      if (!record) throw new AppError(404, ErrorCodes.NOT_FOUND, 'Decision import not found');
      assertSameWorkspace(user, record, 'Decision import not found');
      if (record.status === DecisionImportStatus.confirmed) {
        throw new AppError(409, ErrorCodes.CONFLICT, 'Cannot cancel confirmed import');
      }
      await tx.decisionImport.update({
        where: { id },
        data: { status: DecisionImportStatus.cancelled, processingStep: 'cancelled_by_user' },
      });
      await auditService.log({
        tx,
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.DECISION_IMPORT_CANCELLED,
        entityType: 'decision_import',
        entityId: id,
        decisionImportId: id,
      });
    });
    return this.getDetail(user, id);
  }

  async confirm(user: AuthenticatedUser, id: string, input: ConfirmDecisionImportInput) {
    const record = await this.getRequiredImport(id, user);
    if (record.status === DecisionImportStatus.confirmed) {
      throw new AppError(409, ErrorCodes.CONFLICT, 'Decision import is already confirmed');
    }

    const result = await prisma.$transaction(async (tx) => {
      await lockDecisionImport(tx, id);
      const current = await tx.decisionImport.findUnique({ where: { id }, include: decisionImportInclude });
      if (!current) throw new AppError(404, ErrorCodes.NOT_FOUND, 'Decision import not found');
      assertSameWorkspace(user, current, 'Decision import not found');
      if (current.status === DecisionImportStatus.confirmed || current.status === DecisionImportStatus.cancelled) {
        throw new AppError(409, ErrorCodes.CONFLICT, 'Decision import cannot be confirmed in its current state');
      }
      if (!current.previewRows.length) {
        throw new AppError(400, ErrorCodes.CONFIRM_WITHOUT_PREVIEW, 'Roster preview must exist before confirmation');
      }

      const document = current.documents[0];
      const eventName = input.eventName ?? current.eventName ?? current.title;
      const criterion = input.criterion ?? current.criterion;
      const organizer = input.organizer ?? current.organizer ?? document?.issuer ?? 'Đơn vị quản lý import';
      const organizerLevel = input.organizerLevel ?? current.organizerLevel ?? Level.university;
      if (!criterion) {
        throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'criterion is required to classify the imported decision');
      }

      const rows = selectRowsForConfirm(current.previewRows, input, user.role);
      if (!rows.length) {
        throw new AppError(400, ErrorCodes.ROSTER_EMPTY, 'No valid roster rows selected for confirmation');
      }

      const existing = await tx.eventRegistry.findFirst({
        where: { sourceDecisionImportId: id, workspaceId: current.workspaceId },
      });
      const event = existing
        ? await tx.eventRegistry.update({
            where: { id: existing.id },
            data: {
              eventName,
              criterion,
              organizer,
              organizerLevel,
              startDate: input.startDate ? new Date(input.startDate) : current.startDate,
              endDate: input.endDate ? new Date(input.endDate) : current.endDate,
              convertedValue: input.convertedValue ?? current.convertedValue,
              convertedUnit: input.convertedUnit ?? current.convertedUnit,
              eligibleLevelsJson: input.eligibleLevels ?? current.eligibleLevelsJson ?? undefined,
              participantCount: rows.length,
              rosterIndexed: true,
              status: EventStatus.active,
              decisionDocumentId: document?.id ?? null,
              officialDocumentNo: document?.documentNo ?? null,
              officialIssueDate: document?.issueDate ?? null,
              officialSigner: document?.signer ?? null,
              officialIssuer: document?.issuer ?? null,
            },
          })
        : await tx.eventRegistry.create({
            data: {
              eventName,
              criterion,
              organizer,
              organizerLevel,
              startDate: input.startDate ? new Date(input.startDate) : current.startDate,
              endDate: input.endDate ? new Date(input.endDate) : current.endDate,
              convertedValue: input.convertedValue ?? current.convertedValue,
              convertedUnit: input.convertedUnit ?? current.convertedUnit,
              eligibleLevelsJson: input.eligibleLevels ?? current.eligibleLevelsJson ?? undefined,
              participantCount: rows.length,
              rosterIndexed: true,
              status: EventStatus.active,
              workspaceId: current.workspaceId,
              createdBy: user.id,
              decisionDocumentId: document?.id,
              sourceDecisionImportId: id,
              officialDocumentNo: document?.documentNo,
              officialIssueDate: document?.issueDate,
              officialSigner: document?.signer,
              officialIssuer: document?.issuer,
            },
          });

      if (current.sourceFileId) {
        await tx.eventFile.upsert({
          where: { eventId_fileId: { eventId: event.id, fileId: current.sourceFileId } },
          update: { indexingStatus: IndexingStatus.indexed },
          create: {
            eventId: event.id,
            fileId: current.sourceFileId,
            indexingStatus: IndexingStatus.indexed,
            columnMappingJson: current.columnMappingJson ?? undefined,
          },
        });
      }
      const participantRows: Prisma.EventParticipantCreateManyInput[] = rows.map((row, index) => ({
        eventId: event.id,
        studentCode: row.studentCode!,
        studentName: row.studentName || row.studentCode!,
        className: row.className,
        faculty: row.faculty,
        participationStatus: row.participationStatus ?? 'confirmed',
        indexedRow: index + 1,
        convertedValue: row.convertedValue ?? event.convertedValue,
        sourceFileId: current.sourceFileId,
        sourceDecisionDocumentId: document?.id,
        sourcePage: row.sourcePage,
        sourceTableIndex: row.sourceTableIndex,
        sourceRowIndex: row.sourceRowIndex,
        normalizedConfidence: row.validationStatus === RosterPreviewValidationStatus.valid ? 0.95 : 0.75,
        rawRowJson: row.rawRowJson ?? undefined,
      }));

      await tx.eventParticipant.deleteMany({
        where: input.replaceExistingParticipants
          ? { eventId: event.id }
          : {
              eventId: event.id,
              studentCode: { in: rows.map((row) => row.studentCode!) },
            },
      });
      await tx.eventParticipant.createMany({ data: participantRows });

      await tx.decisionImport.update({
        where: { id },
        data: {
          status: DecisionImportStatus.confirmed,
          confirmedAt: new Date(),
          confirmedBy: user.id,
          processingStep: 'confirmed_to_event_registry',
        },
      });

      await auditService.log({
        tx,
        actorId: user.id,
        actorRole: user.role,
        action: existing ? auditActions.EVENT_REGISTRY_UPDATED : auditActions.EVENT_REGISTRY_CREATED,
        entityType: 'event',
        entityId: event.id,
        eventId: event.id,
        decisionImportId: id,
        metadata: { source: 'decision_import', participantCount: rows.length },
      });
      await auditService.log({
        tx,
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.EVENT_ROSTER_CONFIRMED,
        entityType: 'event',
        entityId: event.id,
        eventId: event.id,
        decisionImportId: id,
        metadata: { participantCount: rows.length },
      });
      await auditService.log({
        tx,
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.DECISION_IMPORT_CONFIRMED,
        entityType: 'decision_import',
        entityId: id,
        eventId: event.id,
        decisionImportId: id,
        metadata: { eventId: event.id, participantCount: rows.length, note: input.note },
      });

      return { event, participantCount: rows.length };
    });

    return {
      eventId: result.event.id,
      participantCount: result.participantCount,
      decisionImport: await this.getDetail(user, id),
    };
  }

  private async getRequiredImport(
    id: string,
    user?: AuthenticatedUser,
  ): Promise<DecisionImportRecord> {
    const record = await this.repository.findById(id);
    if (!record) throw new AppError(404, ErrorCodes.NOT_FOUND, 'Decision import not found');
    if (user) assertSameWorkspace(user, record, 'Decision import not found');
    return record;
  }

  private async toListDtos(records: DecisionImportListRecord[]) {
    if (!records.length) return [];

    const indexingJobIds = Array.from(
      new Set(records.flatMap((record) => [record.metadataJobId, record.rosterJobId].filter(Boolean) as string[])),
    );
    const decisionImportIds = records.map((record) => record.id);

    const [indexingJobs, smartReaderJobs] = await Promise.all([
      indexingJobIds.length
        ? prisma.indexingJob.findMany({ where: { id: { in: indexingJobIds } } })
        : Promise.resolve([]),
      prisma.smartReaderJob.findMany({
        where: { decisionImportId: { in: decisionImportIds } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const indexingJobById = new Map(indexingJobs.map((job) => [job.id, job]));
    const latestSmartReaderJobByImportId = new Map<string, SmartReaderJob>();
    for (const job of smartReaderJobs) {
      if (job.decisionImportId && !latestSmartReaderJobByImportId.has(job.decisionImportId)) {
        latestSmartReaderJobByImportId.set(job.decisionImportId, job);
      }
    }

    return records.map((record) =>
      this.toListDto(record, {
        metadataJob: record.metadataJobId ? indexingJobById.get(record.metadataJobId) ?? null : null,
        rosterJob: record.rosterJobId ? indexingJobById.get(record.rosterJobId) ?? null : null,
        smartReaderJob: latestSmartReaderJobByImportId.get(record.id) ?? null,
      }),
    );
  }

  private toListDto(
    record: DecisionImportListRecord,
    jobs: {
      metadataJob: IndexingJob | null;
      rosterJob: IndexingJob | null;
      smartReaderJob: SmartReaderJob | null;
    },
  ) {
    return {
      id: record.id,
      title: record.title,
      status: record.status,
      sourceFile: record.sourceFile,
      document: record.documents[0] ?? null,
      previewRowCount: record._count.previewRows,
      tableCount: record._count.tables,
      uxStatus: mapDecisionImportUxStatus({
        status: record.status,
        metadataJobStatus: jobs.metadataJob?.status,
        rosterJobStatus: jobs.rosterJob?.status,
        smartReaderStatus: jobs.smartReaderJob?.status,
        previewRowCount: record._count.previewRows,
      }),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private async toDetailDto(record: DecisionImportRecord) {
    const [metadataJob, rosterJob, smartReaderJob] = await Promise.all([
      record.metadataJobId ? prisma.indexingJob.findUnique({ where: { id: record.metadataJobId } }) : null,
      record.rosterJobId ? prisma.indexingJob.findUnique({ where: { id: record.rosterJobId } }) : null,
      prisma.smartReaderJob.findFirst({ where: { decisionImportId: record.id }, orderBy: { createdAt: 'desc' } }),
    ]);
    return {
      id: record.id,
      title: record.title,
      criterion: record.criterion,
      eventName: record.eventName,
      organizer: record.organizer,
      organizerLevel: record.organizerLevel,
      startDate: record.startDate,
      endDate: record.endDate,
      convertedValue: record.convertedValue,
      convertedUnit: record.convertedUnit,
      eligibleLevels: record.eligibleLevelsJson,
      status: record.status,
      processingStep: record.processingStep,
      sourceFile: record.sourceFile,
      document: record.documents[0] ?? null,
      previewSummary: previewSummary(record.previewRows),
      jobs: {
        metadata: metadataJob,
        roster: rosterJob,
        smartreader: smartReaderJob
          ? {
              id: smartReaderJob.id,
              status: smartReaderJob.status,
              endpoint: smartReaderJob.endpoint,
              processedPages: smartReaderJob.progressProcessedPages,
              remainingPages: smartReaderJob.progressRemainingPages,
              resultLink: smartReaderJob.resultLink,
            }
          : null,
      },
      uxStatus: mapDecisionImportUxStatus({
        status: record.status,
        metadataJobStatus: metadataJob?.status,
        rosterJobStatus: rosterJob?.status,
        smartReaderStatus: smartReaderJob?.status,
        previewRowCount: record.previewRows.length,
      }),
      lastError: record.lastErrorCode
        ? {
            code: record.lastErrorCode,
            message: record.lastUserMessage ?? record.lastErrorMessage,
          }
        : null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      confirmedAt: record.confirmedAt,
    };
  }
}

async function findOrCreateDecisionJob(
  tx: Prisma.TransactionClient,
  targetId: string,
  jobType: JobType,
  workspaceId: string,
) {
  const existing = await tx.indexingJob.findFirst({
    where: { targetId, jobType, status: { in: [JobStatus.queued, JobStatus.processing] } },
    orderBy: { createdAt: 'desc' },
  });
  return (
    existing ??
    tx.indexingJob.create({
      data: { targetId, jobType, workspaceId, status: JobStatus.queued, attempts: 0 },
    })
  );
}

export function buildRosterPreview(input: {
  ocr: { tables: NormalizedDecisionTable[] };
  fallbackCriterion?: Criterion | null;
  fallbackConvertedValue?: number | null;
  fallbackConvertedUnit?: string | null;
}) {
  const rosterTables = input.ocr.tables.filter((table) => detectDecisionTableType(table).type === 'roster');
  const primaryTable = rosterTables[0];
  const mapping = primaryTable ? suggestRosterColumnMapping(primaryTable) : undefined;
  const rows = mapping
    ? buildPreviewRowsFromTables({
        tables: rosterTables,
        mapping,
        fallbackCriterion: input.fallbackCriterion,
        fallbackConvertedValue: input.fallbackConvertedValue,
        fallbackConvertedUnit: input.fallbackConvertedUnit,
      })
    : [];
  return { rosterTables, mapping, rows };
}

export function buildPreviewRowsFromTables(input: {
  tables: NormalizedDecisionTable[];
  mapping: DecisionColumnMapping;
  fallbackCriterion?: Criterion | null;
  fallbackConvertedValue?: number | null;
  fallbackConvertedUnit?: string | null;
}): NormalizedRosterPreviewRow[] {
  const rows = input.tables.flatMap((table) =>
    table.rows.map((row) =>
      normalizeRosterRow({
        row,
        mapping: input.mapping,
        fallbackCriterion: input.fallbackCriterion,
        fallbackConvertedValue: input.fallbackConvertedValue,
        fallbackConvertedUnit: input.fallbackConvertedUnit,
        sourcePage: table.pageNumber,
        sourceTableIndex: table.tableIndex,
      }),
    ),
  );
  return markDuplicateRows(rows);
}

export async function persistDecisionRosterExtraction(input: {
  tx: Prisma.TransactionClient;
  decisionImportId: string;
  tables: NormalizedDecisionTable[];
  previewRows: NormalizedRosterPreviewRow[];
  mapping?: DecisionColumnMapping;
}) {
  await input.tx.decisionTable.deleteMany({ where: { decisionImportId: input.decisionImportId } });
  await input.tx.decisionRosterPreviewRow.deleteMany({ where: { decisionImportId: input.decisionImportId } });
  for (const table of input.tables) {
    const detected = detectDecisionTableType(table);
    await input.tx.decisionTable.create({
      data: {
        decisionImportId: input.decisionImportId,
        pageNumber: table.pageNumber,
        tableIndex: table.tableIndex,
        detectedType: detected.type,
        headerJson: table.header,
        rowsCount: table.rows.length,
        confidence: table.confidence ?? detected.confidence,
        rawTableJson: table as unknown as Prisma.InputJsonValue,
      },
    });
  }
  await createPreviewRows(input.tx, input.decisionImportId, input.previewRows);
  await input.tx.decisionImport.update({
    where: { id: input.decisionImportId },
    data: {
      status: DecisionImportStatus.preview_ready,
      processingStep: 'preview_ready',
      columnMappingJson: input.mapping as Prisma.InputJsonValue | undefined,
    },
  });
}

async function lockDecisionImport(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "DecisionImport" WHERE "id" = ${id}::uuid FOR UPDATE`;
}

function assertDecisionImportMutable(
  record: { status: DecisionImportStatus },
  message: string,
) {
  if (record.status === DecisionImportStatus.confirmed || record.status === DecisionImportStatus.cancelled) {
    throw new AppError(409, ErrorCodes.CONFLICT, message);
  }
}

function toNormalizedPreviewRow(row: DecisionImportRecord['previewRows'][number]): NormalizedRosterPreviewRow {
  return {
    studentCode: row.studentCode ?? undefined,
    studentName: row.studentName ?? undefined,
    className: row.className ?? undefined,
    faculty: row.faculty ?? undefined,
    criterion: row.criterion ?? undefined,
    convertedValue: row.convertedValue ?? undefined,
    convertedUnit: row.convertedUnit ?? undefined,
    participationStatus: row.participationStatus ?? undefined,
    sourcePage: row.sourcePage ?? undefined,
    sourceTableIndex: row.sourceTableIndex ?? undefined,
    sourceRowIndex: row.sourceRowIndex ?? undefined,
    validationStatus: row.validationStatus,
    validationWarnings: Array.isArray(row.validationWarningsJson)
      ? row.validationWarningsJson as unknown as NormalizedRosterPreviewRow['validationWarnings']
      : [],
    rawRow: row.rawRowJson && typeof row.rawRowJson === 'object' && !Array.isArray(row.rawRowJson)
      ? row.rawRowJson as Record<string, unknown>
      : {},
  };
}

function rebuildDecisionPreview(
  record: Pick<DecisionImportRecord, 'tables' | 'columnMappingJson' | 'criterion' | 'convertedValue' | 'convertedUnit'>,
  corrections: DecisionRosterCorrections,
) {
  const rosterTables = record.tables.filter((table) => table.detectedType === 'roster');
  const mapping = record.columnMappingJson as DecisionColumnMapping | null;
  if (!mapping) throw new AppError(409, ErrorCodes.CONFLICT, 'Roster mapping is unavailable');
  const baseRows = buildPreviewRowsFromTables({
    tables: rosterTables.map((table) => table.rawTableJson as unknown as NormalizedDecisionTable),
    mapping,
    fallbackCriterion: record.criterion,
    fallbackConvertedValue: record.convertedValue,
    fallbackConvertedUnit: record.convertedUnit,
  });
  return applyDecisionRosterCorrections(baseRows, corrections);
}

function withRowCorrections(resultJson: Prisma.JsonValue | null, corrections: DecisionRosterCorrections): Prisma.InputJsonValue {
  const existing = resultJson && typeof resultJson === 'object' && !Array.isArray(resultJson)
    ? resultJson as Prisma.JsonObject
    : {};
  return { ...existing, rowCorrections: corrections } as Prisma.InputJsonValue;
}

function createPreviewRows(
  tx: Prisma.TransactionClient,
  decisionImportId: string,
  rows: NormalizedRosterPreviewRow[],
) {
  return tx.decisionRosterPreviewRow.createMany({
    data: rows.map((row) => ({
      decisionImportId,
      studentCode: row.studentCode,
      studentName: row.studentName,
      className: row.className,
      faculty: row.faculty,
      criterion: row.criterion,
      convertedValue: row.convertedValue,
      convertedUnit: row.convertedUnit,
      participationStatus: row.participationStatus,
      sourcePage: row.sourcePage,
      sourceTableIndex: row.sourceTableIndex,
      sourceRowIndex: row.sourceRowIndex,
      validationStatus: row.validationStatus,
      validationWarningsJson: row.validationWarnings as Prisma.InputJsonValue,
      rawRowJson: row.rawRow as Prisma.InputJsonValue,
    })),
  });
}

export function normalizeSmartReaderDecisionTables(ocr: Parameters<typeof normalizeDecisionTables>[0]) {
  return normalizeDecisionTables(ocr);
}

function previewSummary(rows: DecisionImportRecord['previewRows']) {
  const counts = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.validationStatus] = (acc[row.validationStatus] ?? 0) + 1;
    return acc;
  }, {});
  return {
    totalRows: rows.length,
    validRows: counts[RosterPreviewValidationStatus.valid] ?? 0,
    warningRows:
      (counts[RosterPreviewValidationStatus.warning] ?? 0) +
      (counts[RosterPreviewValidationStatus.needs_manual_review] ?? 0),
    invalidRows:
      (counts[RosterPreviewValidationStatus.invalid] ?? 0) +
      (counts[RosterPreviewValidationStatus.missing_student_code] ?? 0) +
      (counts[RosterPreviewValidationStatus.duplicate] ?? 0),
    byStatus: counts,
  };
}

function selectRowsForConfirm(
  rows: DecisionImportRecord['previewRows'],
  input: ConfirmDecisionImportInput,
  role: Role,
) {
  const canIncludeInvalid = role === Role.manager || role === Role.admin;
  return rows.filter((row) => {
    if (!row.studentCode) return false;
    if (row.validationStatus === RosterPreviewValidationStatus.valid) return true;
    if (
      input.includeWarningRows &&
      (row.validationStatus === RosterPreviewValidationStatus.warning ||
        row.validationStatus === RosterPreviewValidationStatus.needs_manual_review)
    ) {
      return true;
    }
    return input.includeInvalidRows && canIncludeInvalid && row.validationStatus === RosterPreviewValidationStatus.invalid;
  });
}

export async function importEventAsEvidence(input: {
  user: AuthenticatedUser;
  eventId: string;
  applicationId: string;
  participantId?: string;
  evidenceName?: string;
  note?: string;
}) {
  const application = await prisma.application.findUnique({
    where: { id: input.applicationId },
    include: { student: true },
  });
  if (!application) throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
  assertSameWorkspace(input.user, application, 'Application not found');
  const event = await prisma.eventRegistry.findUnique({
    where: { id: input.eventId },
    include: { workspace: { select: { type: true, isActive: true } } },
  });
  if (!event || event.status !== EventStatus.active) {
    throw new AppError(404, ErrorCodes.EVENT_NOT_APPROVED, 'Event is not approved');
  }
  const isStudent = input.user.role === Role.student || input.user.role === Role.class_representative;
  const canImportCityEvent = canStudentAccessCityEvent(input.user, event);
  if (!canImportCityEvent) assertSameWorkspace(input.user, event, 'Event is not approved');
  if (event.workspaceId !== application.workspaceId && !canImportCityEvent) {
    throw new AppError(404, ErrorCodes.EVENT_OUT_OF_SCOPE, 'Event is out of scope for this application');
  }
  if (event.rosterIndexed === false) {
    throw new AppError(409, ErrorCodes.EVENT_ROSTER_NOT_CONFIRMED, 'Event roster is not confirmed');
  }

  if (isStudent) {
    assertApplicationOwner(application, input.user);
    if (application.status === ApplicationStatus.supplement_required) {
      const hasSupplementTask = await prisma.reviewTask.findFirst({
        where: {
          applicationId: application.id,
          criterion: event?.criterion,
          status: ReviewTaskStatus.supplement_required,
        },
      });
      if (!hasSupplementTask) {
        throw new AppError(
          403,
          ErrorCodes.SUPPLEMENT_SCOPE_VIOLATION,
          'Event is outside supplement scope',
        );
      }
    } else {
      assertApplicationEditable(application);
    }
  }

  const studentCode = isStudent ? input.user.studentCode : application.student.studentCode;
  const studentName = application.student.fullName || (isStudent ? input.user.fullName : null);
  const participant = await resolveParticipantForOfficialImport({
    eventId: event.id,
    participantId: input.participantId,
    studentCode,
    studentName,
  });
  if (!participant) {
    throw new AppError(404, ErrorCodes.EVENT_PARTICIPANT_NOT_FOUND, 'Student is not in the confirmed roster');
  }
  if ((participant.participationStatus ?? 'confirmed').toLowerCase() !== 'confirmed') {
    throw new AppError(400, ErrorCodes.EVENT_PARTICIPANT_NOT_FOUND, 'Participant is not confirmed');
  }

  const existing = await prisma.evidence.findFirst({
    where: { applicationId: application.id, sourceType: EvidenceSourceType.event_import, eventId: event.id },
    include: { evidenceCard: true, evidenceFiles: { include: { file: true } } },
  });
  if (existing) return formatOfficialImportResponse(existing, event, participant, true);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const duplicate = await tx.evidence.findFirst({
        where: { applicationId: application.id, sourceType: EvidenceSourceType.event_import, eventId: event.id },
        include: { evidenceCard: true, evidenceFiles: { include: { file: true } } },
      });
      if (duplicate) return { evidence: duplicate, alreadyImported: true };

      const created = await tx.evidence.create({
        data: {
          applicationId: application.id,
          evidenceName: input.evidenceName ?? event.eventName,
          criterion: event.criterion,
          sourceType: EvidenceSourceType.event_import,
          eventId: event.id,
          status: EvidenceStatus.under_review,
          indexingStatus: IndexingStatus.indexed,
          confidence: 0.96,
        },
      });
      const readableSummary = {
        studentName: participant.studentName,
        studentCode: participant.studentCode,
        className: participant.className,
        faculty: participant.faculty,
        eventName: event.eventName,
        organizer: event.organizer,
        organizerLevel: event.organizerLevel,
        startDate: event.startDate?.toISOString() ?? null,
        endDate: event.endDate?.toISOString() ?? null,
        convertedValue: participant.convertedValue ?? event.convertedValue,
        convertedUnit: event.convertedUnit,
        officialDocumentNo: event.officialDocumentNo,
      };
      const card = await tx.evidenceCard.create({
        data: {
          evidenceId: created.id,
          ocrText: null,
          extractedFieldsJson: {
            source: 'official_matching',
            eventId: event.id,
            participantId: participant.id,
            ...readableSummary,
          },
          matchedEventId: event.id,
          matchedParticipantId: participant.id,
          matchedKnowledgeItemIds: [],
          warningsJson: [],
          confidence: 0.96,
          provider: 'event_registry',
          sourceEndpoint: 'event_registry:confirmed_roster',
          fieldConfidenceJson: {},
          requiresHumanConfirmation: false,
          confirmationStatus: evidenceCardConfirmationStatuses.notRequired,
          confirmedFieldsJson: readableSummary,
          aiSummary: 'Minh chứng được tạo từ danh sách chính thức đã xác nhận.',
          rawAiResponse: Prisma.JsonNull,
        },
      });
      await tx.application.update({
        where: { id: application.id },
        data: { updatedAt: new Date() },
      });
      await createApplicationAudit(tx, {
        actorId: input.user.id,
        actorRole: input.user.role,
        action: auditActions.EVENT_EVIDENCE_IMPORTED_BY_STUDENT,
        targetType: 'evidence',
        targetId: created.id,
        applicationId: application.id,
        workspaceId: application.workspaceId,
        evidenceId: created.id,
        eventId: event.id,
        afterStateJson: {
          eventId: event.id,
          participantId: participant.id,
          studentCodeMasked: maskStudentCode(participant.studentCode),
          criterion: event.criterion,
        },
        note: input.note,
      });
      await createApplicationAudit(tx, {
        actorId: input.user.id,
        actorRole: input.user.role,
        action: auditActions.EVIDENCE_CREATED,
        targetType: 'evidence',
        targetId: created.id,
        applicationId: application.id,
        workspaceId: application.workspaceId,
        evidenceId: created.id,
        eventId: event.id,
        afterStateJson: {
          eventId: event.id,
          participantId: participant.id,
          sourceType: EvidenceSourceType.event_import,
          statusCode: 'official_match_found',
        },
      });
      await createApplicationAudit(tx, {
        actorId: input.user.id,
        actorRole: input.user.role,
        action: auditActions.EVIDENCE_CARD_GENERATED,
        targetType: 'evidence_card',
        targetId: card.id,
        applicationId: application.id,
        workspaceId: application.workspaceId,
        evidenceId: created.id,
        eventId: event.id,
        afterStateJson: {
          evidenceId: created.id,
          eventId: event.id,
          participantId: participant.id,
          statusCode: 'official_match_found',
          warningCount: 0,
        },
      });
      return {
        evidence: {
          ...created,
          evidenceCard: card,
          evidenceFiles: [],
        },
        alreadyImported: false,
      };
    });
    return formatOfficialImportResponse(result.evidence, event, participant, result.alreadyImported);
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const duplicate = await prisma.evidence.findFirst({
      where: { applicationId: application.id, sourceType: EvidenceSourceType.event_import, eventId: event.id },
      include: { evidenceCard: true, evidenceFiles: { include: { file: true } } },
    });
    if (!duplicate) {
      throw new AppError(409, ErrorCodes.EVENT_IMPORT_CONFLICT, 'Event import conflict could not be resolved');
    }
    await createApplicationAudit(prisma, {
      actorId: input.user.id,
      actorRole: input.user.role,
      action: auditActions.EVENT_IMPORT_DUPLICATE_RESOLVED,
      targetType: 'evidence',
      targetId: duplicate.id,
      applicationId: application.id,
      workspaceId: application.workspaceId,
      evidenceId: duplicate.id,
      eventId: event.id,
      afterStateJson: {
        eventId: event.id,
        evidenceId: duplicate.id,
        criterion: event.criterion,
        studentCodeMasked: maskStudentCode(participant.studentCode),
      },
    });
    return formatOfficialImportResponse(duplicate, event, participant, true);
  }
}

async function resolveParticipantForOfficialImport(input: {
  eventId: string;
  participantId?: string;
  studentCode?: string | null;
  studentName?: string | null;
}) {
  if (!input.studentCode && !input.studentName) {
    throw new AppError(
      400,
      ErrorCodes.VALIDATION_ERROR,
      'Student name or student code is required',
    );
  }

  if (input.participantId) {
    const participant = await prisma.eventParticipant.findUnique({ where: { id: input.participantId } });
    if (!participant || participant.eventId !== input.eventId) return null;
    if (
      (input.studentName &&
        normalizeMatchingText(participant.studentName) !== normalizeMatchingText(input.studentName)) ||
      (input.studentCode && participant.studentCode !== input.studentCode)
    ) {
      return null;
    }
    return participant;
  }

  if (input.studentName && input.studentCode) {
    const candidates = await prisma.eventParticipant.findMany({ where: { eventId: input.eventId } });
    return candidates.find(
      (participant) =>
        participant.studentCode === input.studentCode &&
        normalizeMatchingText(participant.studentName) === normalizeMatchingText(input.studentName!),
    ) ?? null;
  }

  if (input.studentName) {
    const candidates = await prisma.eventParticipant.findMany({ where: { eventId: input.eventId } });
    const nameMatch = resolveExactParticipantNameMatch(candidates, input.studentName);
    if (nameMatch.status === 'matched') return nameMatch.participant;
    if (nameMatch.status === 'duplicate') {
      throw new AppError(
        409,
        ErrorCodes.CONFLICT,
        'Multiple confirmed roster participants match this student name',
      );
    }
  }

  if (!input.studentCode) return null;
  return prisma.eventParticipant.findUnique({
    where: { eventId_studentCode: { eventId: input.eventId, studentCode: input.studentCode } },
  });
}

function formatOfficialImportResponse(
  evidence: {
    id: string;
    applicationId: string | null;
    evidenceName: string;
    criterion: Criterion;
    sourceType: EvidenceSourceType;
    eventId: string | null;
    status: EvidenceStatus;
    indexingStatus: IndexingStatus;
    createdAt: Date;
    updatedAt: Date;
    evidenceCard?: {
      id: string;
      extractedFieldsJson: Prisma.JsonValue | null;
      warningsJson: Prisma.JsonValue | null;
      matchedEventId: string | null;
      matchedParticipantId: string | null;
    } | null;
  },
  event: {
    id: string;
    eventName: string;
    criterion: Criterion;
    organizer: string;
    organizerLevel: Level;
    startDate: Date | null;
    endDate: Date | null;
    convertedValue: number | null;
    convertedUnit: string | null;
    officialDocumentNo: string | null;
  },
  participant: {
    id: string;
    studentCode: string;
    studentName: string;
    className: string | null;
    faculty: string | null;
    convertedValue: number | null;
  },
  alreadyImported: boolean,
) {
  const readableSummary = buildReadableSummary(
    evidence.evidenceCard?.extractedFieldsJson ?? {
      studentName: participant.studentName,
      studentCode: participant.studentCode,
      className: participant.className,
      faculty: participant.faculty,
      eventName: event.eventName,
      organizer: event.organizer,
      organizerLevel: event.organizerLevel,
      startDate: event.startDate?.toISOString() ?? null,
      endDate: event.endDate?.toISOString() ?? null,
      convertedValue: participant.convertedValue ?? event.convertedValue,
      convertedUnit: event.convertedUnit,
      officialDocumentNo: event.officialDocumentNo,
    },
  );
  const studentStatus = getEvidenceStudentStatus('official_match_found');
  const matchingStatus = buildOfficialMatchingStatus({
    found: true,
    matchedEventId: event.id,
    matchedEventName: event.eventName,
    matchedParticipantId: participant.id,
  });

  return {
    evidence: {
      id: evidence.id,
      applicationId: evidence.applicationId,
      evidenceName: evidence.evidenceName,
      criterion: evidence.criterion,
      sourceType: evidence.sourceType,
      eventId: evidence.eventId,
      status: evidence.status,
      indexingStatus: evidence.indexingStatus,
      studentStatus,
      createdAt: evidence.createdAt,
      updatedAt: evidence.updatedAt,
    },
    card: {
      readableSummary,
      matchingStatus,
      studentStatus,
      missingFields: [],
      warnings: mapWarnings(evidence.evidenceCard?.warningsJson ?? []),
    },
    alreadyImported,
    message: alreadyImported ? 'Minh chứng đã có trong hồ sơ.' : 'Đã thêm minh chứng vào hồ sơ.',
  };
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function maskStudentCode(studentCode: string | null | undefined) {
  if (!studentCode) return null;
  const trimmed = studentCode.trim();
  if (trimmed.length <= 4) return '*'.repeat(trimmed.length);
  return `${trimmed.slice(0, 2)}${'*'.repeat(Math.max(2, trimmed.length - 4))}${trimmed.slice(-2)}`;
}

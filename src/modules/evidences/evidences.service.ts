// Owns evidence records, evidence files, indexing triggers, and evidence cards.
import {
  ApplicationStatus,
  Criterion,
  EvidenceSourceType,
  EvidenceStatus,
  FileStorageType,
  IndexingStatus,
  JobStatus,
  JobType,
  Prisma,
  ReviewTaskStatus,
  Role,
} from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { StorageService } from '../storage/storage.service';
import { sanitizeFileName } from '../storage/storage.types';
import { env } from '../../config/env';
import { auditActions } from '../../shared/constants/application';
import {
  buildMissingFields,
  buildReadableSummary,
  getEvidenceStudentStatus,
  mapWarnings,
  resolveMatchingStatusForCard,
  resolveStudentStatusForCard,
} from '../../shared/dto/evidence-student-status';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { assertSameWorkspace } from '../../shared/utils/workspace-scope';
import {
  assertApplicationEditable,
  assertApplicationOwner,
  createApplicationAudit,
} from '../applications/application.helpers';
import { AuditService } from '../audit/audit.service';
import { buildEvidenceAnalysisJobInput, parseEvidenceAnalysisJobInput } from '../jobs/evidence-analysis-job-input';
import { JobsService } from '../jobs/jobs.service';
import {
  buildEffectiveEvidenceCardFields,
  evidenceCardConfirmationStatuses,
  isEvidenceProcessing,
  mergeFieldCorrections,
  normalizeConfirmationStatus,
  validateEvidenceCardCorrections,
} from './evidence-card-confirmation';
import { buildEvidenceCardFieldLayers } from './evidence-card-field-presenter';
import { mapEvidenceUxStatus } from './evidence-ux-status.mapper';
import { EvidencesRepository } from './evidences.repository';
import type {
  ConfirmEvidenceCardInput,
  CreateEvidenceInput,
  ListEvidencesQuery,
  SaveEvidenceCardCorrectionsInput,
  StartIndexingInput,
  UpdateEvidenceInput,
} from './evidences.validation';

type UploadedEvidenceFile = Express.Multer.File;

export class EvidencesService {
  constructor(
    private readonly evidencesRepository = new EvidencesRepository(),
    private readonly storageService = new StorageService(),
    private readonly jobsService = new JobsService(),
    private readonly auditService = new AuditService(),
  ) {}

  async list(user: AuthenticatedUser, applicationId: string, query: ListEvidencesQuery) {
    const application = await this.getRequiredApplication(applicationId);
    assertSameWorkspace(user, application, 'Application not found');
    this.assertCanViewApplication(user, application);

    const { items, total } = await this.evidencesRepository.list(applicationId, query);
    return {
      items: items.map((item) => this.toEvidenceDto(item, user)),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async create(user: AuthenticatedUser, applicationId: string, input: CreateEvidenceInput) {
    const application = await this.getRequiredApplication(applicationId);
    assertSameWorkspace(user, application, 'Application not found');
    if (user.role === Role.student || user.role === Role.class_representative) {
      assertApplicationOwner(application, user);
      await this.assertSupplementCriterionScope(application.id, application.status, input.criterion);
    } else if (
      user.role !== Role.officer &&
      user.role !== Role.manager &&
      user.role !== Role.admin
    ) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Role cannot create application evidence');
    }
    assertApplicationEditable(application);

    if (input.sourceType !== EvidenceSourceType.manual_upload) {
      throw new AppError(
        400,
        ErrorCodes.VALIDATION_ERROR,
        'sourceType must be manual_upload for uploaded evidence',
      );
    }

    const status: EvidenceStatus = EvidenceStatus.draft;
    const indexingStatus: IndexingStatus = IndexingStatus.not_started;

    const eventId = input.eventId ?? input.metadata?.eventId ?? null;

    const evidence = await prisma.$transaction(async (tx) => {
      const created = await tx.evidence.create({
        data: {
          applicationId,
          evidenceName: input.evidenceName,
          criterion: input.criterion,
          sourceType: input.sourceType,
          eventId: eventId,
          status,
          indexingStatus,
        },
      });

      // Optionally create an EvidenceCard with description/metadata to store them without schema changes
      if (input.description || input.metadata) {
        await tx.evidenceCard.create({
          data: {
            evidenceId: created.id,
            ocrText: input.description ?? 'Minh chứng được nhập thủ công.',
            extractedFieldsJson: (input.metadata ?? {}) as Prisma.InputJsonValue,
            warningsJson: [],
            confidence: 1.0,
            confirmationStatus: evidenceCardConfirmationStatuses.pending,
            requiresHumanConfirmation: true,
            aiSummary: 'Minh chứng xét duyệt thủ công không dùng AI.',
            rawAiResponse: { manual: true },
          },
        });
      }

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.EVIDENCE_CREATED,
        targetType: 'evidence',
        targetId: created.id,
        applicationId,
        workspaceId: application.workspaceId,
        afterStateJson: {
          evidenceName: created.evidenceName,
          criterion: created.criterion,
          sourceType: created.sourceType,
          status: created.status,
        },
      });

      return created;
    });

    return this.getRequiredEvidenceDto(evidence.id, user);
  }

  async update(user: AuthenticatedUser, evidenceId: string, input: UpdateEvidenceInput) {
    const evidence = await this.getRequiredEvidence(evidenceId);
    assertApplicationOwner(evidence.application!, user);
    await this.assertSupplementCriterionScope(
      evidence.application!.id,
      evidence.application!.status,
      evidence.criterion,
    );
    if (input.criterion) {
      await this.assertSupplementCriterionScope(
        evidence.application!.id,
        evidence.application!.status,
        input.criterion,
      );
    }
    assertApplicationEditable(evidence.application!);

    if (
      evidence.status === EvidenceStatus.accepted ||
      evidence.status === EvidenceStatus.rejected ||
      evidence.status === EvidenceStatus.resolution_needed
    ) {
      throw new AppError(
        400,
        ErrorCodes.EVIDENCE_NOT_EDITABLE,
        'Cannot update evidence that has already been decided or escalated',
      );
    }

    await prisma.$transaction(async (tx) => {
      const updated = await tx.evidence.update({
        where: { id: evidence.id },
        data: input,
      });

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.EVIDENCE_UPDATED,
        targetType: 'evidence',
        targetId: evidence.id,
        applicationId: evidence.applicationId,
        workspaceId: evidence.application!.workspaceId,
        beforeStateJson: {
          evidenceName: evidence.evidenceName,
          criterion: evidence.criterion,
        },
        afterStateJson: {
          evidenceName: updated.evidenceName,
          criterion: updated.criterion,
        },
      });
    });

    return this.getRequiredEvidenceDto(evidence.id, user);
  }

  async get(user: AuthenticatedUser, evidenceId: string) {
    const evidence = await this.getRequiredEvidence(evidenceId);
    this.assertCanViewEvidence(user, evidence);
    return this.toEvidenceDto(evidence, user);
  }

  async getAudit(user: AuthenticatedUser, evidenceId: string) {
    const evidence = await this.getRequiredEvidence(evidenceId);
    this.assertCanViewEvidence(user, evidence);

    const jobIds = await this.findEvidenceJobIds(evidence.id);
    const logs = await this.findEvidenceAuditLogs(evidence.id, jobIds);

    return {
      evidenceId: evidence.id,
      items: logs.map((log) => ({
        id: log.id,
        action: log.action,
        targetType: log.targetType,
        targetId: log.targetId,
        actorRole: log.actorRole,
        metadataJson: log.metadataJson,
        createdAt: log.createdAt,
      })),
    };
  }

  async delete(user: AuthenticatedUser, evidenceId: string) {
    const evidence = await this.getRequiredEvidence(evidenceId);
    assertApplicationOwner(evidence.application!, user);
    assertApplicationEditable(evidence.application!);

    if (
      evidence.status === EvidenceStatus.accepted ||
      evidence.status === EvidenceStatus.rejected ||
      evidence.status === EvidenceStatus.resolution_needed
    ) {
      throw new AppError(
        400,
        ErrorCodes.EVIDENCE_NOT_EDITABLE,
        'Cannot delete evidence that has already been decided or escalated',
      );
    }

    const filesToDelete = evidence.evidenceFiles.map((link) => ({
      filePath: link.file.filePath,
      storageType: link.file.storageType,
    }));

    await prisma.$transaction(async (tx) => {
      await tx.evidenceCard.deleteMany({ where: { evidenceId: evidence.id } });
      await tx.evidenceFile.deleteMany({ where: { evidenceId: evidence.id } });
      await tx.file.deleteMany({
        where: {
          id: { in: evidence.evidenceFiles.map((link) => link.fileId) },
        },
      });
      await tx.evidence.delete({ where: { id: evidence.id } });

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.EVIDENCE_DELETED,
        targetType: 'evidence',
        targetId: evidence.id,
        applicationId: evidence.applicationId,
        workspaceId: evidence.application!.workspaceId,
        beforeStateJson: {
          evidenceName: evidence.evidenceName,
          fileCount: evidence.evidenceFiles.length,
        },
      });
    });

    for (const f of filesToDelete) {
      await this.storageService.deleteObject(f.filePath, f.storageType);
    }

    return { deleted: true };
  }

  async uploadFile(
    user: AuthenticatedUser,
    evidenceId: string,
    file?: UploadedEvidenceFile,
    body?: { displayName?: string; note?: string },
  ) {
    if (!file) {
      throw new AppError(400, ErrorCodes.EVIDENCE_FILE_REQUIRED, 'Evidence file is required');
    }

    const evidence = await this.getRequiredEvidence(evidenceId);

    // Business rule: Student phải là owner application nếu role student.
    // Application còn editable hoặc đang supplement_required cho evidence/criterion đó.
    if (user.role === Role.student || user.role === Role.class_representative) {
      assertApplicationOwner(evidence.application!, user);

      if (evidence.application!.status === ApplicationStatus.supplement_required) {
        // Check if there is an active supplement request for this criterion
        const hasSupplementTask = await prisma.reviewTask.findFirst({
          where: {
            applicationId: evidence.applicationId,
            criterion: evidence.criterion,
            status: ReviewTaskStatus.supplement_required,
          },
        });
        if (!hasSupplementTask) {
          throw new AppError(
            403,
            ErrorCodes.EVIDENCE_NOT_EDITABLE,
            'This evidence/criterion does not require supplement',
          );
        }
      } else {
        assertApplicationEditable(evidence.application!);
      }
    }

    // Business rule: Officer/manager có thể upload file bổ sung chỉ khi workflow cho phép.
    const isStaff =
      user.role === Role.officer ||
      user.role === Role.manager ||
      user.role === Role.admin ||
      user.role === Role.committee;

    if (isStaff) {
      const allowedStaffStatuses: ApplicationStatus[] = [
        ApplicationStatus.under_review,
        ApplicationStatus.supplement_required,
        ApplicationStatus.resolution_needed,
        ApplicationStatus.draft,
        ApplicationStatus.prechecked,
        ApplicationStatus.ready_to_submit,
      ];
      if (!allowedStaffStatuses.includes(evidence.application!.status)) {
        throw new AppError(
          403,
          ErrorCodes.EVIDENCE_NOT_EDITABLE,
          `Workflow does not allow staff to upload files when application status is ${evidence.application!.status}`,
        );
      }
    }

    // Business rule: Không cho upload vào evidence accepted/rejected/completed trừ manager/admin.
    const isManagerOrAdmin = user.role === Role.manager || user.role === Role.admin;
    if (!isManagerOrAdmin) {
      if (
        evidence.status === EvidenceStatus.accepted ||
        evidence.status === EvidenceStatus.rejected ||
        evidence.application!.status === ApplicationStatus.completed ||
        evidence.application!.status === ApplicationStatus.rejected
      ) {
        throw new AppError(
          403,
          ErrorCodes.EVIDENCE_NOT_EDITABLE,
          'Cannot upload files to already finalized evidence or application unless you are manager/admin',
        );
      }
    }

    // Validate MIME Type
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new AppError(
        400,
        ErrorCodes.FILE_TYPE_NOT_ALLOWED,
        'File type not allowed. Only JPEG, PNG, WEBP, and PDF are allowed.',
      );
    }

    // Validate File Size
    const maxSizeBytes = (env.MAX_FILE_SIZE_MB || 10) * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      throw new AppError(
        400,
        ErrorCodes.FILE_TOO_LARGE,
        `File is too large. Max allowed size is ${env.MAX_FILE_SIZE_MB || 10}MB.`,
      );
    }

    // Generate Structured Object Key
    const applicationId = evidence.applicationId ?? 'unknown-app';
    const timestamp = Date.now();
    const normalizedOriginalName = normalizeUploadedFileName(file.originalname);
    const safeOriginalName = sanitizeFileName(normalizedOriginalName);
    const objectKey = `applications/${applicationId}/evidences/${evidence.id}/${timestamp}-${safeOriginalName}`;

    // Upload via StorageService
    await this.storageService.uploadObject({
      key: objectKey,
      buffer: file.buffer,
      contentType: file.mimetype,
    });

    const result = await prisma.$transaction(async (tx) => {
      const originalName = body?.displayName || normalizedOriginalName;
      const fileRecord = await tx.file.create({
        data: {
          ownerId: user.id,
          workspaceId: evidence.application!.workspaceId,
          storageType: env.STORAGE_DRIVER === 'r2' ? FileStorageType.r2 : FileStorageType.local,
          filePath: objectKey,
          publicUrl: null,
          originalName,
          mimeType: file.mimetype,
          fileSize: file.size,
          uploadedBy: user.id,
        },
      });

      const fileRole = evidence.evidenceFiles.length === 0 ? 'primary' : 'supporting';
      const evidenceFile = await tx.evidenceFile.create({
        data: {
          evidenceId: evidence.id,
          fileId: fileRecord.id,
          fileRole,
        },
      });

      let status = evidence.status;
      let indexingStatus = evidence.indexingStatus;

      if (evidence.sourceType === EvidenceSourceType.manual_upload) {
        status = EvidenceStatus.pending_indexing;
        indexingStatus = IndexingStatus.pending_indexing;
      }

      const jobInput = buildEvidenceAnalysisJobInput({
        evidenceId: evidence.id,
        evidenceFileId: evidenceFile.id,
        fileId: fileRecord.id,
      });
      const activeJobs = await tx.indexingJob.findMany({
        where: {
          targetId: evidence.id,
          jobType: JobType.evidence_ocr,
          status: { in: [JobStatus.queued, JobStatus.processing] },
        },
        orderBy: { createdAt: 'desc' },
      });
      const existingJob = activeJobs.find((activeJob) => {
        try {
          const activeInput = parseEvidenceAnalysisJobInput(activeJob.inputJson);
          return (
            activeInput.evidenceFileId === jobInput.evidenceFileId &&
            activeInput.fileId === jobInput.fileId
          );
        } catch {
          return false;
        }
      });
      const job =
        existingJob ??
        (await tx.indexingJob.create({
          data: {
            workspaceId: evidence.application!.workspaceId,
            targetId: evidence.id,
            jobType: JobType.evidence_ocr,
            status: JobStatus.queued,
            attempts: 0,
            inputJson: jobInput,
          },
        }));

      if (evidence.sourceType === EvidenceSourceType.manual_upload && evidence.evidenceCard) {
        await tx.evidenceCard.update({
          where: { evidenceId: evidence.id },
          data: {
            confirmationStatus: evidenceCardConfirmationStatuses.pending,
            confirmedFieldsJson: Prisma.JsonNull,
            confirmedByUserId: null,
            confirmedAt: null,
            lastCorrectedAt: null,
            requiresHumanConfirmation: true,
          },
        });
        await createApplicationAudit(tx, {
          actorId: user.id,
          actorRole: user.role,
          action: auditActions.EVIDENCE_CARD_CONFIRMATION_INVALIDATED,
          targetType: 'evidence_card',
          targetId: evidence.evidenceCard.id,
          applicationId: evidence.applicationId,
          workspaceId: evidence.application!.workspaceId,
          evidenceId: evidence.id,
          beforeStateJson: {
            confirmationStatus: normalizeConfirmationStatus(evidence.evidenceCard.confirmationStatus),
            confirmedAt: evidence.evidenceCard.confirmedAt,
          },
          afterStateJson: {
            confirmationStatus: evidenceCardConfirmationStatuses.pending,
            reason: 'file_replaced',
          },
        });
      }

      const updatedEvidence = await tx.evidence.update({
        where: { id: evidence.id },
        data: {
          status,
          indexingStatus,
        },
        include: {
          application: { include: { student: true, metrics: true } },
          collectiveProfile: true,
          event: true,
          evidenceFiles: {
            include: {
              file: true,
            },
            orderBy: { id: 'asc' as const },
          },
          evidenceCard: true,
        },
      });

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.FILE_STORED,
        targetType: 'file',
        targetId: fileRecord.id,
        applicationId: evidence.applicationId,
        workspaceId: evidence.application!.workspaceId,
        afterStateJson: { filePath: fileRecord.filePath, mimeType: fileRecord.mimeType },
      });

      await this.auditService.log({
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.FILE_UPLOADED,
        entityType: 'file',
        entityId: fileRecord.id,
        applicationId: evidence.applicationId,
        evidenceId: evidence.id,
        workspaceId: evidence.application!.workspaceId,
        after: { fileId: fileRecord.id, fileRole, displayName: originalName },
        metadata: { note: body?.note ?? null },
        tx,
      });

      await this.auditService.log({
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.OCR_JOB_CREATED,
        entityType: 'indexing_job',
        entityId: job.id,
        applicationId: evidence.applicationId,
        evidenceId: evidence.id,
        workspaceId: evidence.application!.workspaceId,
        after: {
          jobId: job.id,
          jobType: job.jobType,
          status: job.status,
          reused: !!existingJob,
        },
        tx,
      });

      return {
        evidence: this.toEvidenceDto(updatedEvidence, user),
        file: {
          id: fileRecord.id,
          evidenceId: evidence.id,
          originalName: fileRecord.originalName,
          mimeType: fileRecord.mimeType,
          size: fileRecord.fileSize,
          storageType: fileRecord.storageType,
          storageKey: fileRecord.filePath,
          publicUrl: fileRecord.publicUrl,
          uploadedAt: fileRecord.createdAt.toISOString(),
        },
        job,
        jobId: job.id,
        mode: 'ocr_queued',
        studentStatus: {
          ...getEvidenceStudentStatus('recorded_waiting_review'),
          message: 'Minh chứng đã được lưu. Hệ thống sẽ đọc nhanh file để tạo tóm tắt.',
          nextAction: 'view_evidence',
        },
      };
    }, { timeout: 20000 });

    return result;
  }

  async startIndexing(user: AuthenticatedUser, evidenceId: string, _input: StartIndexingInput) {
    const evidence = await this.getRequiredEvidence(evidenceId);
    this.assertCanViewEvidence(user, evidence);

    const currentFile = resolveNewestEvidenceFile(evidence.evidenceFiles);
    if (!currentFile) {
      throw new AppError(400, ErrorCodes.EVIDENCE_FILE_REQUIRED, 'Evidence has no file to index');
    }
    const jobInput = buildEvidenceAnalysisJobInput({
      evidenceId: evidence.id,
      evidenceFileId: currentFile.id,
      fileId: currentFile.fileId,
    });
    const { job, reused } = await this.jobsService.enqueueIndexingJob(
      evidence.id,
      JobType.evidence_ocr,
      evidence.application!.workspaceId,
      jobInput as Prisma.InputJsonValue,
    );
    await prisma.evidence.update({
      where: { id: evidence.id },
      data: {
        status: EvidenceStatus.pending_indexing,
        indexingStatus: IndexingStatus.pending_indexing,
      },
    });

    const updatedEvidence = await this.getRequiredEvidence(evidence.id);
    return {
      evidence: this.toEvidenceDto(updatedEvidence, user),
      job,
      jobId: job.id,
      mode: reused ? 'ocr_job_reused' : 'ocr_queued',
      message: 'Evidence OCR job is queued.',
    };
  }

  async getCard(user: AuthenticatedUser, evidenceId: string) {
    const evidence = await this.getRequiredEvidence(evidenceId);
    this.assertCanViewEvidence(user, evidence);

    const isPrivileged = this.isPrivileged(user);
    const latestJob = await this.findLatestEvidenceJob(evidence.id);
    const latestSmartReaderJob = await this.findLatestSmartReaderJob(evidence.id);
    const auditSummary = await this.getEvidenceAuditSummary(evidence.id);
    const uxStatus = mapEvidenceUxStatus({
      evidenceStatus: evidence.status,
      indexingStatus: evidence.indexingStatus,
      jobStatus: latestJob?.status,
      smartReaderStatus: latestSmartReaderJob?.status,
      hasCard: !!evidence.evidenceCard,
      confidence: evidence.confidence,
    });

    return {
      evidence: this.toEvidenceDto(evidence, user),
      card: evidence.evidenceCard ? this.toEvidenceCardDto(evidence, isPrivileged, user) : null,
      job: latestJob
        ? {
            id: latestJob.id,
            status: latestJob.status,
            attempts: latestJob.attempts,
            errorMessage: latestJob.errorMessage,
            resultJson: isPrivileged ? latestJob.resultJson : undefined,
            retryable: latestJob.status === JobStatus.failed,
          }
        : null,
      indexingStatus: evidence.indexingStatus,
      uxStatus,
      auditSummary,
    };
  }

  async saveCardCorrections(
    user: AuthenticatedUser,
    evidenceId: string,
    input: SaveEvidenceCardCorrectionsInput,
  ) {
    const evidence = await this.getRequiredEvidence(evidenceId);
    await this.assertCanMutateEvidenceCard(user, evidence);
    this.assertCardReadyForStudentAction(evidence, 'edit');
    if (evidence.sourceType === EvidenceSourceType.event_import) {
      throw new AppError(
        403,
        ErrorCodes.EVIDENCE_CARD_EDIT_NOT_ALLOWED,
        'Trusted event import fields cannot be edited here',
      );
    }
    if (input.expectedUpdatedAt && evidence.evidenceCard?.updatedAt.toISOString() !== input.expectedUpdatedAt) {
      throw new AppError(409, ErrorCodes.EVIDENCE_CARD_STALE, 'Evidence card changed; refresh before editing');
    }

    const corrections = validateEvidenceCardCorrections(input.fields);
    const beforeFields = evidence.evidenceCard!.confirmedFieldsJson;
    const merged = mergeFieldCorrections(beforeFields, corrections);
    const changedFields = Object.keys(corrections);

    await prisma.$transaction(async (tx) => {
      await tx.evidenceCard.update({
        where: { evidenceId: evidence.id },
        data: {
          confirmedFieldsJson: merged as Prisma.InputJsonValue,
          confirmationStatus: evidenceCardConfirmationStatuses.correctionRequired,
          requiresHumanConfirmation: true,
          lastCorrectedAt: new Date(),
        },
      });
      await tx.evidence.update({
        where: { id: evidence.id },
        data: { updatedAt: new Date() },
      });
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.EVIDENCE_CARD_CORRECTION_SAVED,
        targetType: 'evidence_card',
        targetId: evidence.evidenceCard!.id,
        applicationId: evidence.applicationId,
        workspaceId: evidence.application!.workspaceId,
        evidenceId: evidence.id,
        beforeStateJson: { fields: pickSafeFields(beforeFields, changedFields) },
        afterStateJson: {
          fields: pickSafeFields(merged, changedFields),
          changedFields,
          confirmationStatus: evidenceCardConfirmationStatuses.correctionRequired,
        },
      });
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.PRECHECK_INVALIDATED_BY_EVIDENCE_CARD,
        targetType: 'evidence',
        targetId: evidence.id,
        applicationId: evidence.applicationId,
        workspaceId: evidence.application!.workspaceId,
        evidenceId: evidence.id,
        afterStateJson: { reason: 'evidence_card_correction', changedFields },
      });
    });

    return this.getCard(user, evidence.id);
  }

  async confirmCard(user: AuthenticatedUser, evidenceId: string, input: ConfirmEvidenceCardInput) {
    const evidence = await this.getRequiredEvidence(evidenceId);
    await this.assertCanMutateEvidenceCard(user, evidence);
    this.assertCardReadyForStudentAction(evidence, 'confirm');
    if (evidence.sourceType === EvidenceSourceType.event_import) {
      throw new AppError(
        403,
        ErrorCodes.EVIDENCE_CARD_CONFIRMATION_NOT_ALLOWED,
        'Trusted event import cards do not require confirmation',
      );
    }
    const card = evidence.evidenceCard!;
    const confirmationStatus = normalizeConfirmationStatus(card.confirmationStatus);
    if (confirmationStatus === evidenceCardConfirmationStatuses.confirmed) {
      throw new AppError(409, ErrorCodes.EVIDENCE_CARD_ALREADY_CONFIRMED, 'Evidence card is already confirmed');
    }
    if (input.expectedUpdatedAt && card.updatedAt.toISOString() !== input.expectedUpdatedAt) {
      throw new AppError(409, ErrorCodes.EVIDENCE_CARD_STALE, 'Evidence card changed; refresh before confirming');
    }

    const effective = buildEffectiveEvidenceCardFields({
      sourceType: evidence.sourceType,
      provider: card.provider,
      extractedFields: card.extractedFieldsJson,
      normalizedFields: card.normalizedFieldsJson,
      confirmedFields: card.confirmedFieldsJson,
      fieldConfidence: card.fieldConfidenceJson,
      warnings: card.warningsJson,
      confirmationStatus,
    }).effectiveFields;

    await prisma.$transaction(async (tx) => {
      await tx.evidenceCard.update({
        where: { evidenceId: evidence.id },
        data: {
          confirmedFieldsJson: effective as Prisma.InputJsonValue,
          confirmationStatus: evidenceCardConfirmationStatuses.confirmed,
          requiresHumanConfirmation: false,
          confirmedByUserId: user.id,
          confirmedAt: new Date(),
        },
      });
      await tx.evidence.update({
        where: { id: evidence.id },
        data: { updatedAt: new Date() },
      });
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.EVIDENCE_CARD_CONFIRMED,
        targetType: 'evidence_card',
        targetId: card.id,
        applicationId: evidence.applicationId,
        workspaceId: evidence.application!.workspaceId,
        evidenceId: evidence.id,
        beforeStateJson: { confirmationStatus },
        afterStateJson: {
          confirmationStatus: evidenceCardConfirmationStatuses.confirmed,
          confirmedFieldCount: Object.keys(effective).length,
          acknowledgedWarnings: input.acknowledgedWarnings ?? [],
        },
      });
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.PRECHECK_INVALIDATED_BY_EVIDENCE_CARD,
        targetType: 'evidence',
        targetId: evidence.id,
        applicationId: evidence.applicationId,
        workspaceId: evidence.application!.workspaceId,
        evidenceId: evidence.id,
        afterStateJson: { reason: 'evidence_card_confirmed' },
      });
    });

    return this.getCard(user, evidence.id);
  }

  private async getRequiredApplication(applicationId: string) {
    const application = await this.evidencesRepository.findApplication(applicationId);
    if (!application) {
      throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
    }
    return application;
  }

  private async getRequiredEvidence(evidenceId: string) {
    const evidence = await this.evidencesRepository.findEvidence(evidenceId);
    if (!evidence) {
      throw new AppError(404, ErrorCodes.EVIDENCE_NOT_FOUND, 'Evidence not found');
    }
    if (!evidence.application || !evidence.applicationId) {
      throw new AppError(404, ErrorCodes.EVIDENCE_NOT_FOUND, 'Application evidence not found');
    }
    return evidence;
  }

  private async getRequiredEvidenceDto(evidenceId: string, user: AuthenticatedUser) {
    const evidence = await this.getRequiredEvidence(evidenceId);
    return this.toEvidenceDto(evidence, user);
  }

  private assertCanViewApplication(user: AuthenticatedUser, application: { studentId: string }) {
    if (application.studentId === user.id) return;
    if (user.role === Role.manager || user.role === Role.committee || user.role === Role.admin) {
      return;
    }
    if (user.role === Role.officer) return;
    throw new AppError(403, ErrorCodes.FORBIDDEN, 'Cannot view application evidences');
  }

  private assertCanViewEvidence(
    user: AuthenticatedUser,
    evidence: Awaited<ReturnType<EvidencesRepository['findEvidence']>>,
  ) {
    if (!evidence) {
      throw new AppError(404, ErrorCodes.EVIDENCE_NOT_FOUND, 'Evidence not found');
    }
    if (!evidence.application) {
      throw new AppError(404, ErrorCodes.EVIDENCE_NOT_FOUND, 'Application evidence not found');
    }
    assertSameWorkspace(user, evidence.application, 'Evidence not found');
    this.assertCanViewApplication(user, evidence.application);
  }

  private findLatestEvidenceJob(evidenceId: string) {
    return this.evidencesRepository.findLatestEvidenceJob?.(evidenceId) ?? Promise.resolve(null);
  }

  private findLatestSmartReaderJob(evidenceId: string) {
    return this.evidencesRepository.findLatestSmartReaderJob?.(evidenceId) ?? Promise.resolve(null);
  }

  private findEvidenceJobIds(evidenceId: string) {
    return this.evidencesRepository.findEvidenceJobIds?.(evidenceId) ?? Promise.resolve([]);
  }

  private findEvidenceAuditLogs(evidenceId: string, jobIds: string[]) {
    return (
      this.evidencesRepository.findEvidenceAuditLogs?.(evidenceId, jobIds) ?? Promise.resolve([])
    );
  }

  private async getEvidenceAuditSummary(evidenceId: string) {
    const logs = await (this.evidencesRepository.findEvidenceAuditSummaryLogs?.(evidenceId) ??
      Promise.resolve([]));
    return {
      total: logs.length,
      latestAction: logs[0]?.action ?? null,
      latestAt: logs[0]?.createdAt ?? null,
      actions: logs.reduce<Record<string, number>>((acc, log) => {
        acc[log.action] = (acc[log.action] ?? 0) + 1;
        return acc;
      }, {}),
    };
  }

  private toEvidenceDto(
    evidence: NonNullable<Awaited<ReturnType<EvidencesRepository['findEvidence']>>>,
    user: AuthenticatedUser,
  ) {
    const isPrivileged = this.isPrivileged(user);
    const studentStatus = resolveStudentStatusForCard({
      sourceType: evidence.sourceType,
      status: evidence.status,
      indexingStatus: evidence.indexingStatus,
      criterion: evidence.criterion,
      ocrText: evidence.evidenceCard?.ocrText,
      fields:
        evidence.evidenceCard?.normalizedFieldsJson ?? evidence.evidenceCard?.extractedFieldsJson,
      warnings: evidence.evidenceCard?.warningsJson,
      matchedEventId: evidence.evidenceCard?.matchedEventId,
      matchedParticipantId: evidence.evidenceCard?.matchedParticipantId,
    });

    return {
      id: evidence.id,
      applicationId: evidence.applicationId,
      evidenceName: evidence.evidenceName,
      criterion: evidence.criterion,
      sourceType: evidence.sourceType,
      status: evidence.status,
      indexingStatus: evidence.indexingStatus,
      ...(isPrivileged ? { internalConfidence: evidence.confidence } : {}),
      studentStatus,
      uxStatus: mapEvidenceUxStatus({
        evidenceStatus: evidence.status,
        indexingStatus: evidence.indexingStatus,
        hasCard: !!evidence.evidenceCard,
        confidence: isPrivileged ? evidence.confidence : null,
      }),
      createdAt: evidence.createdAt,
      updatedAt: evidence.updatedAt,
      files: evidence.evidenceFiles.map((link) => ({
        id: link.file.id,
        originalName: link.file.originalName,
        mimeType: link.file.mimeType,
        fileSize: link.file.fileSize,
        publicUrl: link.file.publicUrl,
        fileRole: link.fileRole,
      })),
      card: evidence.evidenceCard
        ? {
            id: evidence.evidenceCard.id,
            confirmationStatus: normalizeConfirmationStatus(evidence.evidenceCard.confirmationStatus),
            requiresHumanConfirmation: evidence.evidenceCard.requiresHumanConfirmation,
            ...(isPrivileged ? { internalConfidence: evidence.evidenceCard.confidence } : {}),
            studentStatus,
            warnings: mapWarnings(evidence.evidenceCard.warningsJson),
          }
        : null,
    };
  }

  private toEvidenceCardDto(
    evidence: NonNullable<Awaited<ReturnType<EvidencesRepository['findEvidence']>>>,
    isPrivileged: boolean,
    user?: AuthenticatedUser,
  ) {
    const card = evidence.evidenceCard;
    if (!card) return null;

    const fieldState = buildEffectiveEvidenceCardFields({
      sourceType: evidence.sourceType,
      provider: card.provider,
      extractedFields: card.extractedFieldsJson,
      normalizedFields: card.normalizedFieldsJson,
      confirmedFields: card.confirmedFieldsJson,
      fieldConfidence: card.fieldConfidenceJson,
      warnings: card.warningsJson,
      confirmationStatus: card.confirmationStatus,
    });
    const fields = fieldState.effectiveFields;
    const fieldLayers = buildEvidenceCardFieldLayers({
      evidenceName: evidence.evidenceName,
      sourceType: evidence.sourceType,
      criterion: evidence.criterion,
      extractedFields: card.extractedFieldsJson,
      normalizedFields: fields,
      matchedEventId: card.matchedEventId,
      matchedParticipantId: card.matchedParticipantId,
      warnings: card.warningsJson,
      studentProfileFields: {
        studentName: evidence.application?.student?.fullName,
        studentCode: evidence.application?.student?.studentCode,
        className: evidence.application?.student?.className,
        faculty: evidence.application?.student?.faculty,
      },
      applicationMetrics:
        evidence.application?.metrics?.map((metric) => ({
          metricType: metric.metricType,
          value: metric.value,
          scale: metric.scale,
        })) ?? [],
      targetLevel: evidence.application?.targetLevel,
    });
    const readableSummary = buildReadableSummary(fields);
    const warnings = mapWarnings(card.warningsJson);
    const missingFields = buildMissingFields(evidence.criterion, fields, card.warningsJson);
    const studentStatus = resolveStudentStatusForCard({
      sourceType: evidence.sourceType,
      status: evidence.status,
      indexingStatus: evidence.indexingStatus,
      criterion: evidence.criterion,
      ocrText: card.ocrText,
      fields: fields as Prisma.JsonValue,
      warnings: card.warningsJson,
      matchedEventId: card.matchedEventId,
      matchedParticipantId: card.matchedParticipantId,
    });
    const matchingStatus = resolveMatchingStatusForCard({
      matchedEventId: card.matchedEventId,
      matchedEventName: readableSummary.eventName,
      matchedParticipantId: card.matchedParticipantId,
      warnings: card.warningsJson,
    });

    const studentCard = {
      id: card.id,
      provider: card.provider,
      confirmationStatus: normalizeConfirmationStatus(card.confirmationStatus),
      requiresHumanConfirmation: card.requiresHumanConfirmation,
      confirmedFields: fieldState.confirmedFields,
      effectiveFields: fieldState.effectiveFields,
      fieldDetails: fieldState.fieldDetails,
      confirmedAt: card.confirmedAt,
      confirmedByUserId: card.confirmedByUserId,
      canEdit: user ? this.canMutateEvidenceCard(user, evidence) && this.isCardReadyForStudentAction(evidence) : false,
      canConfirm:
        user ?
          this.canMutateEvidenceCard(user, evidence) &&
          this.isCardReadyForStudentAction(evidence) &&
          evidence.sourceType !== EvidenceSourceType.event_import &&
          normalizeConfirmationStatus(card.confirmationStatus) !== evidenceCardConfirmationStatuses.confirmed
        : false,
      readableSummary,
      userProvidedFields: fieldLayers.userProvidedFields,
      studentProfileFields: fieldLayers.studentProfileFields,
      extractedFields: fieldLayers.extractedFields,
      normalizedFields: fieldLayers.normalizedFields,
      verifiedFields: fieldLayers.verifiedFields,
      primaryFields: fieldLayers.primaryFields,
      fieldConfidence: normalizeFieldConfidence(card.fieldConfidenceJson) ?? fieldLayers.fieldConfidence,
      metricSuggestions: fieldLayers.metricSuggestions,
      academic: fieldLayers.academic,
      matchingStatus,
      missingFields,
      studentStatus,
      warnings,
      ocrTextPreview: previewText(card.ocrText),
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
    };

    if (!isPrivileged) return studentCard;

    return {
      ...studentCard,
      ocrText: card.ocrText,
      ocrLinesJson: card.ocrLinesJson,
      ocrParagraphsJson: card.ocrParagraphsJson,
      ocrTablesJson: card.ocrTablesJson,
      extractedFieldsJson: card.extractedFieldsJson,
      normalizedFieldsJson: card.normalizedFieldsJson,
      warningsJson: card.warningsJson,
      matchedEventId: card.matchedEventId,
      matchedParticipantId: card.matchedParticipantId,
      matchedKnowledgeItemIds: card.matchedKnowledgeItemIds,
      internalConfidence: card.confidence,
      providerModel: card.provider === 'openai' ? undefined : card.providerModel,
      promptVersion: card.provider === 'openai' ? undefined : card.promptVersion,
      sourceEndpoint: card.sourceEndpoint,
      smartreaderJobId: card.smartreaderJobId,
      technicalSummary: card.aiSummary,
      rawAiResponse: card.provider === 'openai' ? undefined : card.rawAiResponse,
      rawResponseJson: card.provider === 'openai' ? undefined : card.rawResponseJson,
    };
  }

  private isPrivileged(user: AuthenticatedUser) {
    return (
      user.role === Role.officer ||
      user.role === Role.manager ||
      user.role === Role.committee ||
      user.role === Role.admin
    );
  }

  private async assertSupplementCriterionScope(
    applicationId: string,
    applicationStatus: ApplicationStatus,
    criterion: Criterion,
  ) {
    if (applicationStatus !== ApplicationStatus.supplement_required) return;
    const hasSupplementTask = await prisma.reviewTask.findFirst({
      where: {
        applicationId,
        criterion,
        status: ReviewTaskStatus.supplement_required,
      },
    });
    if (!hasSupplementTask) {
      throw new AppError(
        403,
        ErrorCodes.SUPPLEMENT_SCOPE_VIOLATION,
        'Evidence is outside supplement scope',
      );
    }
  }

  private async assertCanMutateEvidenceCard(
    user: AuthenticatedUser,
    evidence: NonNullable<Awaited<ReturnType<EvidencesRepository['findEvidence']>>>,
  ) {
    if (user.role !== Role.student && user.role !== Role.class_representative) {
      throw new AppError(403, ErrorCodes.EVIDENCE_CARD_CONFIRMATION_NOT_ALLOWED, 'Only students can confirm evidence cards');
    }
    assertSameWorkspace(user, evidence.application!, 'Evidence not found');
    assertApplicationOwner(evidence.application!, user);
    if (evidence.application!.status === ApplicationStatus.supplement_required) {
      const hasSupplementTask = await prisma.reviewTask.findFirst({
        where: {
          applicationId: evidence.applicationId,
          criterion: evidence.criterion,
          status: ReviewTaskStatus.supplement_required,
        },
      });
      if (!hasSupplementTask) {
        throw new AppError(403, ErrorCodes.SUPPLEMENT_SCOPE_VIOLATION, 'Evidence is outside supplement scope');
      }
    } else {
      assertApplicationEditable(evidence.application!);
    }
    if (
      evidence.status === EvidenceStatus.accepted ||
      evidence.status === EvidenceStatus.rejected ||
      evidence.status === EvidenceStatus.resolution_needed
    ) {
      throw new AppError(403, ErrorCodes.EVIDENCE_CARD_EDIT_NOT_ALLOWED, 'Evidence is locked');
    }
  }

  private canMutateEvidenceCard(
    user: AuthenticatedUser,
    evidence: NonNullable<Awaited<ReturnType<EvidencesRepository['findEvidence']>>>,
  ) {
    if (user.role !== Role.student && user.role !== Role.class_representative) return false;
    if (evidence.application?.studentId !== user.id) return false;
    if (
      evidence.application?.status !== ApplicationStatus.supplement_required &&
      evidence.application?.status !== ApplicationStatus.draft &&
      evidence.application?.status !== ApplicationStatus.prechecked &&
      evidence.application?.status !== ApplicationStatus.ready_to_submit
    ) {
      return false;
    }
    return (
      evidence.status !== EvidenceStatus.accepted &&
      evidence.status !== EvidenceStatus.rejected &&
      evidence.status !== EvidenceStatus.resolution_needed
    );
  }

  private assertCardReadyForStudentAction(
    evidence: NonNullable<Awaited<ReturnType<EvidencesRepository['findEvidence']>>>,
    action: 'edit' | 'confirm',
  ) {
    if (!this.isCardReadyForStudentAction(evidence)) {
      throw new AppError(
        409,
        action === 'edit' ? ErrorCodes.EVIDENCE_CARD_EDIT_NOT_ALLOWED : ErrorCodes.EVIDENCE_CARD_NOT_READY,
        'Evidence card is not ready',
      );
    }
  }

  private isCardReadyForStudentAction(
    evidence: NonNullable<Awaited<ReturnType<EvidencesRepository['findEvidence']>>>,
  ) {
    return Boolean(
      evidence.evidenceCard &&
      !isEvidenceProcessing(evidence.indexingStatus) &&
      evidence.indexingStatus !== IndexingStatus.failed,
    );
  }
}

function pickSafeFields(value: unknown, keys: string[]) {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  return Object.fromEntries(keys.map((key) => [key, record[key] ?? null]));
}

function previewText(value?: string | null): string | undefined {
  if (!value?.trim()) return undefined;
  return value.trim().replace(/\s+/g, ' ').slice(0, 240);
}

function normalizeUploadedFileName(fileName: string) {
  if (!looksLikeMojibake(fileName)) return fileName;
  const decoded = Buffer.from(fileName, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? fileName : decoded;
}

function normalizeFieldConfidence(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value).filter((entry): entry is [string, number] => {
    const [, confidence] = entry;
    return typeof confidence === 'number' && Number.isFinite(confidence);
  });
  return entries.length ? Object.fromEntries(entries) : null;
}

function resolveNewestEvidenceFile(
  evidenceFiles: Array<{ id: string; fileId: string; file: { createdAt: Date; id: string } }>,
) {
  return [...evidenceFiles].sort((left, right) => {
    const createdDiff = right.file.createdAt.getTime() - left.file.createdAt.getTime();
    if (createdDiff !== 0) return createdDiff;
    const fileIdDiff = right.file.id.localeCompare(left.file.id);
    if (fileIdDiff !== 0) return fileIdDiff;
    return right.id.localeCompare(left.id);
  })[0] ?? null;
}

function looksLikeMojibake(value: string) {
  return /(?:\u00C3|\u00C2|\u00C4|\u00E1\u00BA|\u00E1\u00BB|\u00C6|\u00D0)/.test(value);
}

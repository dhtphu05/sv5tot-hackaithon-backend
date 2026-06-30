// Owns event registry, roster indexing, participants, and application imports.
import {
  EventStatus,
  EvidenceSourceType,
  EvidenceStatus,
  FileStorageType,
  IndexingStatus,
  JobType,
  Role,
  type EventRegistry,
} from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { LocalStorageService } from '../../infrastructure/storage/local-storage.service';
import { auditActions } from '../../shared/constants/application';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import {
  assertApplicationEditable,
  assertApplicationOwner,
  createApplicationAudit,
} from '../applications/application.helpers';
import { runIndexingJob } from '../jobs/jobs.service';
import type { RosterPreviewResult } from '../jobs/processors/event-roster-indexing.processor';
import {
  applyColumnMapping,
  type NormalizedParticipantInput,
} from './event-participant.normalizer';
import { EventRegistryRepository } from './event-registry.repository';
import type {
  ApplicationIdBody,
  ConfirmIndexInput,
  CreateEventInput,
  ListEventsQuery,
  ParticipantsQuery,
  StartRosterIndexingInput,
  UpdateEventInput,
} from './event-registry.validation';

type UploadedRosterFile = Express.Multer.File;

export class EventRegistryService {
  constructor(
    private readonly repository = new EventRegistryRepository(),
    private readonly storageService = new LocalStorageService(),
  ) {}

  async list(user: AuthenticatedUser, query: ListEventsQuery) {
    const { items, total } = await this.repository.list(user, query);
    return {
      items: items.map(this.toEventDto),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async create(user: AuthenticatedUser, input: CreateEventInput) {
    const event = await prisma.$transaction(async (tx) => {
      const created = await tx.eventRegistry.create({
        data: {
          eventName: input.eventName,
          criterion: input.criterion,
          organizer: input.organizer,
          organizerLevel: input.organizerLevel,
          startDate: input.startDate ? new Date(input.startDate) : undefined,
          endDate: input.endDate ? new Date(input.endDate) : undefined,
          convertedValue: input.convertedValue,
          convertedUnit: input.convertedUnit,
          eligibleLevelsJson: input.eligibleLevels ?? [],
          participantCount: 0,
          rosterIndexed: false,
          status: EventStatus.draft,
          createdBy: user.id,
        },
      });

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.EVENT_CREATED,
        targetType: 'event',
        targetId: created.id,
        afterStateJson: { eventName: created.eventName, criterion: created.criterion },
      });

      return created;
    });

    return this.getDetail(user, event.id);
  }

  async getDetail(user: AuthenticatedUser, eventId: string) {
    const event = await this.getRequiredEvent(eventId);
    this.assertCanViewEvent(user, event);
    return this.toEventDto(event);
  }

  async update(user: AuthenticatedUser, eventId: string, input: UpdateEventInput) {
    const event = await this.getRequiredEvent(eventId);

    if (event.rosterIndexed && input.criterion && input.criterion !== event.criterion) {
      throw new AppError(409, ErrorCodes.CONFLICT, 'Cannot change criterion after roster indexing');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.eventRegistry.update({
        where: { id: event.id },
        data: {
          ...(input.eventName ? { eventName: input.eventName } : {}),
          ...(input.criterion ? { criterion: input.criterion } : {}),
          ...(input.organizer ? { organizer: input.organizer } : {}),
          ...(input.organizerLevel ? { organizerLevel: input.organizerLevel } : {}),
          ...(input.startDate ? { startDate: new Date(input.startDate) } : {}),
          ...(input.endDate ? { endDate: new Date(input.endDate) } : {}),
          ...(input.convertedValue !== undefined ? { convertedValue: input.convertedValue } : {}),
          ...(input.convertedUnit ? { convertedUnit: input.convertedUnit } : {}),
          ...(input.eligibleLevels ? { eligibleLevelsJson: input.eligibleLevels } : {}),
          ...(input.status ? { status: input.status } : {}),
        },
      });

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action:
          input.status === EventStatus.archived
            ? auditActions.EVENT_ARCHIVED
            : auditActions.EVENT_UPDATED,
        targetType: 'event',
        targetId: event.id,
        beforeStateJson: { status: event.status, criterion: event.criterion },
        afterStateJson: { status: saved.status, criterion: saved.criterion },
      });

      return saved;
    });

    return this.getDetail(user, updated.id);
  }

  async uploadRosterFile(user: AuthenticatedUser, eventId: string, file?: UploadedRosterFile) {
    const event = await this.getRequiredEvent(eventId);
    if (!file) {
      throw new AppError(400, ErrorCodes.EVENT_ROSTER_REQUIRED, 'Roster file is required');
    }

    const storedFile = await this.storageService.saveFile({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      directory: `event-rosters/${event.id}`,
    });

    const result = await prisma.$transaction(async (tx) => {
      const fileRecord = await tx.file.create({
        data: {
          ownerId: user.id,
          storageType: FileStorageType.local,
          filePath: storedFile.filePath,
          publicUrl: storedFile.publicUrl,
          originalName: file.originalname,
          mimeType: file.mimetype,
          fileSize: file.size,
          uploadedBy: user.id,
        },
      });

      const eventFile = await tx.eventFile.create({
        data: {
          eventId: event.id,
          fileId: fileRecord.id,
          indexingStatus: IndexingStatus.uploaded,
        },
      });

      const job = await tx.indexingJob.create({
        data: {
          jobType: JobType.event_roster_indexing,
          targetId: eventFile.id,
          status: 'queued',
          attempts: 0,
        },
      });

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.EVENT_ROSTER_FILE_UPLOADED,
        targetType: 'event',
        targetId: event.id,
        afterStateJson: { fileId: fileRecord.id, eventFileId: eventFile.id },
      });
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.EVENT_ROSTER_INDEXING_JOB_CREATED,
        targetType: 'job',
        targetId: job.id,
        afterStateJson: { eventFileId: eventFile.id, status: job.status },
      });

      return { file: fileRecord, eventFile, job };
    });

    return result;
  }

  async startIndexing(user: AuthenticatedUser, eventId: string, input: StartRosterIndexingInput) {
    const event = await this.getRequiredEvent(eventId);
    const eventFile = input.eventFileId
      ? await this.repository.findEventFile(input.eventFileId)
      : await this.repository.findLatestEventFile(event.id);

    if (!eventFile || eventFile.eventId !== event.id) {
      throw new AppError(404, ErrorCodes.EVENT_FILE_NOT_FOUND, 'Event roster file not found');
    }

    const activeJob = await prisma.indexingJob.findFirst({
      where: {
        targetId: eventFile.id,
        jobType: JobType.event_roster_indexing,
        status: { in: ['queued', 'processing'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    const job =
      activeJob ??
      (await prisma.indexingJob.create({
        data: {
          jobType: JobType.event_roster_indexing,
          targetId: eventFile.id,
          status: 'queued',
          attempts: 0,
        },
      }));

    await prisma.eventFile.update({
      where: { id: eventFile.id },
      data: { indexingStatus: IndexingStatus.pending_indexing },
    });
    await createApplicationAudit(prisma, {
      actorId: user.id,
      actorRole: user.role,
      action: auditActions.EVENT_ROSTER_INDEXING_STARTED,
      targetType: 'event',
      targetId: event.id,
      afterStateJson: { eventFileId: eventFile.id, jobId: job.id },
    });

    if (input.runMode === 'sync') {
      const completed = await runIndexingJob(job.id);
      const refreshedEventFile = await this.repository.findEventFile(eventFile.id);
      return {
        job: completed,
        eventFile: refreshedEventFile,
        preview: completed.resultJson,
      };
    }

    return { job, eventFile, preview: null };
  }

  async listParticipants(user: AuthenticatedUser, eventId: string, query: ParticipantsQuery) {
    if (user.role === Role.student || user.role === Role.class_representative) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Students cannot list event participants');
    }

    const event = await this.getRequiredEvent(eventId);

    if (query.preview) {
      const eventFile = await this.repository.findLatestEventFile(event.id);
      if (!eventFile)
        throw new AppError(404, ErrorCodes.EVENT_FILE_NOT_FOUND, 'Event file not found');
      const job = await this.repository.findLatestCompletedRosterJob(eventFile.id);
      const preview = job?.resultJson as RosterPreviewResult | undefined;
      return {
        items: preview?.rows ?? [],
        pagination: {
          page: 1,
          limit: preview?.rows.length ?? 0,
          total: preview?.rows.length ?? 0,
          totalPages: 1,
        },
      };
    }

    const { items, total } = await this.repository.listParticipants(event.id, query);
    return {
      items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async confirmIndex(user: AuthenticatedUser, eventId: string, input: ConfirmIndexInput) {
    const event = await this.getRequiredEvent(eventId);
    const eventFile = input.eventFileId
      ? await this.repository.findEventFile(input.eventFileId)
      : await this.repository.findLatestEventFile(event.id);
    if (!eventFile)
      throw new AppError(404, ErrorCodes.EVENT_FILE_NOT_FOUND, 'Event file not found');

    const job = await this.repository.findLatestCompletedRosterJob(eventFile.id);
    if (!job?.resultJson) {
      throw new AppError(
        400,
        ErrorCodes.EVENT_INDEXING_NOT_COMPLETED,
        'Roster indexing must complete before confirm',
      );
    }

    const preview = job.resultJson as RosterPreviewResult;
    const participants: NormalizedParticipantInput[] = [];
    const rejectedRows: Array<Record<string, unknown>> = [];

    preview.rows.forEach((row) => {
      const participant = applyColumnMapping(row, input.columnMapping, {
        convertedValue: event.convertedValue,
      });
      if (!participant) rejectedRows.push(row);
      else participants.push(participant);
    });

    if (participants.length === 0) {
      throw new AppError(400, ErrorCodes.ROSTER_EMPTY, 'Roster has no valid participants');
    }

    await prisma.$transaction(async (tx) => {
      if (input.replaceExisting) {
        await tx.eventParticipant.deleteMany({ where: { eventId: event.id } });
      }

      for (const [index, participant] of participants.entries()) {
        await tx.eventParticipant.upsert({
          where: {
            eventId_studentCode: {
              eventId: event.id,
              studentCode: participant.studentCode,
            },
          },
          update: {
            studentName: participant.studentName,
            className: participant.className,
            faculty: participant.faculty,
            participationStatus: participant.participationStatus,
            indexedRow: index + 1,
            convertedValue: participant.convertedValue,
            sourceFileId: eventFile.fileId,
          },
          create: {
            eventId: event.id,
            studentCode: participant.studentCode,
            studentName: participant.studentName,
            className: participant.className,
            faculty: participant.faculty,
            participationStatus: participant.participationStatus,
            indexedRow: index + 1,
            convertedValue: participant.convertedValue,
            sourceFileId: eventFile.fileId,
          },
        });
      }

      const participantCount = await tx.eventParticipant.count({ where: { eventId: event.id } });
      await tx.eventRegistry.update({
        where: { id: event.id },
        data: {
          participantCount,
          rosterIndexed: true,
          status: EventStatus.active,
        },
      });
      await tx.eventFile.update({
        where: { id: eventFile.id },
        data: {
          columnMappingJson: input.columnMapping,
          indexQualityScore: preview.quality.confidence,
          indexingStatus: IndexingStatus.indexed,
        },
      });

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.EVENT_ROSTER_INDEX_CONFIRMED,
        targetType: 'event',
        targetId: event.id,
        afterStateJson: {
          participantCount,
          rejectedRows: rejectedRows.length,
          eventFileId: eventFile.id,
        },
        note: `Confirmed roster for ${event.eventName}`,
      });
    });

    return this.getDetail(user, event.id);
  }

  async checkParticipant(user: AuthenticatedUser, eventId: string, input: ApplicationIdBody) {
    const application = await this.getRequiredApplication(input.applicationId);
    assertApplicationOwner(application, user);

    const event = await this.getRequiredEvent(eventId);
    this.assertActiveIndexedEvent(event);

    if (!user.studentCode) {
      throw new AppError(400, ErrorCodes.STUDENT_CODE_REQUIRED, 'Student code is required');
    }

    const participant = await prisma.eventParticipant.findUnique({
      where: {
        eventId_studentCode: {
          eventId: event.id,
          studentCode: user.studentCode,
        },
      },
    });

    await createApplicationAudit(prisma, {
      actorId: user.id,
      actorRole: user.role,
      action: auditActions.EVENT_PARTICIPANT_CHECKED,
      targetType: 'event',
      targetId: event.id,
      applicationId: application.id,
      afterStateJson: { found: Boolean(participant), studentCode: user.studentCode },
    });

    return participant
      ? { found: true, participant, canImport: true, reason: null }
      : {
          found: false,
          participant: null,
          canImport: false,
          reason: 'Không tìm thấy MSSV của bạn trong danh sách đã xác nhận.',
        };
  }

  async importToApplication(user: AuthenticatedUser, eventId: string, input: ApplicationIdBody) {
    const application = await this.getRequiredApplication(input.applicationId);
    assertApplicationOwner(application, user);
    assertApplicationEditable(application);

    const event = await this.getRequiredEvent(eventId);
    this.assertActiveIndexedEvent(event);

    if (!user.studentCode) {
      throw new AppError(400, ErrorCodes.STUDENT_CODE_REQUIRED, 'Student code is required');
    }

    const participant = await prisma.eventParticipant.findUnique({
      where: { eventId_studentCode: { eventId: event.id, studentCode: user.studentCode } },
    });
    if (!participant) {
      throw new AppError(404, ErrorCodes.PARTICIPANT_NOT_FOUND, 'Participant was not found');
    }

    const existing = await prisma.evidence.findFirst({
      where: {
        applicationId: application.id,
        sourceType: EvidenceSourceType.event_import,
        eventId: event.id,
      },
      include: { evidenceCard: true },
    });
    if (existing) {
      throw new AppError(409, ErrorCodes.EVENT_ALREADY_IMPORTED, 'Event already imported');
    }

    const warnings = this.buildEventImportWarnings(event, participant);
    const confidence = warnings.some((warning) => warning.code === 'EVENT_MISSING_CONVERTED_VALUE')
      ? 0.75
      : warnings.some((warning) => warning.code === 'EVENT_MISSING_DATE')
        ? 0.85
        : 0.95;

    const result = await prisma.$transaction(async (tx) => {
      const evidence = await tx.evidence.create({
        data: {
          applicationId: application.id,
          evidenceName: event.eventName,
          criterion: event.criterion,
          sourceType: EvidenceSourceType.event_import,
          eventId: event.id,
          status: EvidenceStatus.indexed,
          indexingStatus: IndexingStatus.indexed,
          confidence,
        },
      });

      const extractedFieldsJson = {
        source: 'event_registry',
        eventId: event.id,
        eventName: event.eventName,
        criterion: event.criterion,
        organizer: event.organizer,
        organizerLevel: event.organizerLevel,
        startDate: event.startDate?.toISOString() ?? null,
        endDate: event.endDate?.toISOString() ?? null,
        convertedValue: participant.convertedValue ?? event.convertedValue,
        convertedUnit: event.convertedUnit,
        studentCode: participant.studentCode,
        studentName: participant.studentName,
        className: participant.className,
        faculty: participant.faculty,
        participationStatus: participant.participationStatus,
      };

      const card = await tx.evidenceCard.create({
        data: {
          evidenceId: evidence.id,
          ocrText: `Minh chứng được tạo từ sự kiện ${event.eventName} với danh sách tham gia đã xác nhận.`,
          extractedFieldsJson,
          warningsJson: warnings,
          matchedEventId: event.id,
          matchedKnowledgeItemIds: [],
          confidence,
          aiSummary:
            'Minh chứng này được tạo từ danh sách sự kiện đã được cán bộ xác nhận. Cán bộ xét duyệt vẫn là người xác nhận kết quả cuối cùng.',
          rawAiResponse: { source: 'event_registry_import' },
        },
      });

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.EVENT_EVIDENCE_IMPORTED,
        targetType: 'evidence',
        targetId: evidence.id,
        applicationId: application.id,
        afterStateJson: { eventId: event.id, confidence },
      });
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.EVENT_IMPORT_EVIDENCE_CARD_CREATED,
        targetType: 'evidence',
        targetId: evidence.id,
        applicationId: application.id,
        afterStateJson: { cardId: card.id },
      });

      return { evidence, card };
    });

    return result;
  }

  private async getRequiredEvent(eventId: string) {
    const event = await this.repository.findById(eventId);
    if (!event) throw new AppError(404, ErrorCodes.EVENT_NOT_FOUND, 'Event not found');
    return event;
  }

  private async getRequiredApplication(applicationId: string) {
    const application = await prisma.application.findUnique({ where: { id: applicationId } });
    if (!application) {
      throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
    }
    return application;
  }

  private assertCanViewEvent(user: AuthenticatedUser, event: EventRegistry): void {
    if (user.role === Role.student || user.role === Role.class_representative) {
      this.assertActiveIndexedEvent(event);
    }
  }

  private assertActiveIndexedEvent(event: EventRegistry): void {
    if (event.status !== EventStatus.active) {
      throw new AppError(403, ErrorCodes.EVENT_NOT_ACTIVE, 'Event is not active');
    }
    if (!event.rosterIndexed) {
      throw new AppError(403, ErrorCodes.EVENT_NOT_INDEXED, 'Event roster is not indexed');
    }
  }

  private buildEventImportWarnings(
    event: EventRegistry,
    participant: { convertedValue: number | null },
  ) {
    const warnings: Array<{ code: string; message: string }> = [
      {
        code: 'EVENT_REGISTRY_IMPORT_REQUIRES_REVIEW',
        message: 'Minh chứng nhập từ Event Registry vẫn cần cán bộ xét duyệt xác nhận cuối cùng.',
      },
    ];
    if (!event.startDate || !event.endDate) {
      warnings.push({
        code: 'EVENT_MISSING_DATE',
        message: 'Sự kiện thiếu ngày bắt đầu hoặc kết thúc.',
      });
    }
    if (participant.convertedValue === null && event.convertedValue === null) {
      warnings.push({
        code: 'EVENT_MISSING_CONVERTED_VALUE',
        message: 'Sự kiện thiếu giá trị quy đổi.',
      });
    }
    if (!event.organizerLevel) {
      warnings.push({
        code: 'EVENT_ORGANIZER_LEVEL_UNKNOWN',
        message: 'Chưa rõ cấp đơn vị tổ chức.',
      });
    }
    return warnings;
  }

  private toEventDto(
    event: EventRegistry & { eventFiles?: unknown[]; sampleCertificateFile?: unknown },
  ) {
    return {
      id: event.id,
      eventName: event.eventName,
      criterion: event.criterion,
      organizer: event.organizer,
      organizerLevel: event.organizerLevel,
      startDate: event.startDate,
      endDate: event.endDate,
      convertedValue: event.convertedValue,
      convertedUnit: event.convertedUnit,
      eligibleLevels: event.eligibleLevelsJson,
      participantCount: event.participantCount,
      rosterIndexed: event.rosterIndexed,
      status: event.status,
      eventFiles: event.eventFiles,
      sampleCertificateFile: event.sampleCertificateFile,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    };
  }
}

// Owns event registry, roster indexing, participants, and application imports.
import {
  EventStatus,
  FileStorageType,
  IndexingStatus,
  JobType,
  Role,
  type EventRegistry,
} from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../infrastructure/database/prisma';
import { auditActions } from '../../shared/constants/application';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { assertSameWorkspace, workspaceIdForWrite } from '../../shared/utils/workspace-scope';
import {
  createApplicationAudit,
} from '../applications/application.helpers';
import { runIndexingJob } from '../jobs/jobs.service';
import type { RosterPreviewResult } from '../jobs/processors/event-roster-indexing.processor';
import { StorageService } from '../storage/storage.service';
import {
  applyColumnMapping,
  type NormalizedParticipantInput,
} from './event-participant.normalizer';
import { toStaffEventWorkspaceDto } from './event-registry.dto';
import { EventRegistryRepository } from './event-registry.repository';
import type {
  CheckParticipantInput,
  ConfirmIndexInput,
  CreateEventInput,
  ImportParticipantsJsonInput,
  ImportAsEvidenceInput,
  ImportToApplicationInput,
  ListEventsQuery,
  ParticipantsQuery,
  SearchEventsQuery,
  StartRosterIndexingInput,
  UpdateEventInput,
} from './event-registry.validation';
import { importEventAsEvidence } from '../decision-imports/decision-imports.service';
import { EvidenceMatchingService } from '../evidence-matching/evidence-matching.service';

type UploadedRosterFile = Express.Multer.File;

export class EventRegistryService {
  constructor(
    private readonly repository = new EventRegistryRepository(),
    private readonly storageService = new StorageService(),
    private readonly evidenceMatchingService = new EvidenceMatchingService(),
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
    let status: EventStatus = EventStatus.draft;
    if (input.status === 'confirmed') {
      status = EventStatus.active;
    } else if (input.status === 'archived') {
      if (user.role === Role.officer) {
        status = EventStatus.draft;
      } else {
        status = EventStatus.archived;
      }
    }

    const event = await prisma.$transaction(async (tx) => {
      const created = await tx.eventRegistry.create({
        data: {
          eventName: input.eventName,
          criterion: input.criterion,
          organizer: input.organizer,
          organizerLevel: input.organizerLevel,
          startDate: input.startDate ? new Date(input.startDate) : undefined,
          endDate: input.endDate ? new Date(input.endDate) : undefined,
          participantCount: 0,
          rosterIndexed: false,
          status,
          workspaceId: workspaceIdForWrite(user),
          createdBy: user.id,
        },
      });

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: status === EventStatus.active ? 'EVENT_CONFIRMED' : auditActions.EVENT_CREATED,
        targetType: 'event',
        targetId: created.id,
        afterStateJson: { eventName: created.eventName, criterion: created.criterion, status: created.status },
      });

      return created;
    });

    return this.getDetail(user, event.id);
  }

  async getDetail(user: AuthenticatedUser, eventId: string) {
    const event = await this.getRequiredEvent(user, eventId);
    this.assertCanViewEvent(user, event);
    return this.toEventDto(event);
  }

  async getStaffWorkspace(user: AuthenticatedUser, eventId: string) {
    if (user.role === Role.student || user.role === Role.class_representative) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Students cannot view staff event workspace');
    }

    const event = await this.repository.findStaffWorkspaceById(eventId);
    if (!event) throw new AppError(404, ErrorCodes.EVENT_NOT_FOUND, 'Event not found');
    assertSameWorkspace(user, event, 'Event not found');

    const latestEventFile = event.eventFiles[0] ?? null;
    const latestJob = latestEventFile
      ? await this.repository.findLatestCompletedRosterJob(latestEventFile.id)
      : null;

    return toStaffEventWorkspaceDto(event, latestJob?.resultJson);
  }

  async update(user: AuthenticatedUser, eventId: string, input: UpdateEventInput) {
    const event = await this.getRequiredEvent(user, eventId);

    if (event.rosterIndexed && input.criterion && input.criterion !== event.criterion) {
      throw new AppError(409, ErrorCodes.CONFLICT, 'Cannot change criterion after roster indexing');
    }

    let mappedStatus: EventStatus | undefined;
    if (input.status) {
      if (input.status === 'confirmed') {
        mappedStatus = EventStatus.active;
      } else if (input.status === 'archived') {
        mappedStatus = EventStatus.archived;
      } else {
        mappedStatus = EventStatus.draft;
      }
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
          ...(mappedStatus ? { status: mappedStatus } : {}),
        },
      });

      let auditAction: string = auditActions.EVENT_UPDATED;
      if (mappedStatus && mappedStatus !== event.status) {
        if (mappedStatus === EventStatus.active) {
          auditAction = 'EVENT_CONFIRMED';
        } else if (mappedStatus === EventStatus.archived) {
          auditAction = auditActions.EVENT_ARCHIVED;
        }
      }

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditAction,
        targetType: 'event',
        targetId: event.id,
        beforeStateJson: { status: event.status, criterion: event.criterion },
        afterStateJson: { status: saved.status, criterion: saved.criterion },
      });

      return saved;
    });

    return this.getDetail(user, updated.id);
  }

  async delete(user: AuthenticatedUser, eventId: string) {
    const event = await this.getRequiredEvent(user, eventId);

    await prisma.$transaction(async (tx) => {
      await tx.eventParticipant.deleteMany({ where: { eventId: event.id } });
      await tx.eventFile.deleteMany({ where: { eventId: event.id } });
      await tx.eventRegistry.delete({ where: { id: event.id } });

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: 'EVENT_DELETED',
        targetType: 'event',
        targetId: event.id,
        beforeStateJson: { eventName: event.eventName },
      });
    });

    return { deleted: true };
  }

  async uploadRosterFile(user: AuthenticatedUser, eventId: string, file?: UploadedRosterFile) {
    const event = await this.getRequiredEvent(user, eventId);
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
          storageType: env.STORAGE_DRIVER === 'r2' ? FileStorageType.r2 : FileStorageType.local,
          filePath: storedFile.filePath,
          publicUrl: storedFile.publicUrl,
          originalName: file.originalname,
          mimeType: file.mimetype,
          fileSize: file.size,
          workspaceId: event.workspaceId,
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
          workspaceId: event.workspaceId,
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
    const event = await this.getRequiredEvent(user, eventId);
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
          workspaceId: event.workspaceId,
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

    const event = await this.getRequiredEvent(user, eventId);

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

  async search(user: AuthenticatedUser, query: SearchEventsQuery) {
    return this.evidenceMatchingService.search(user, query);
  }

  async confirmIndex(user: AuthenticatedUser, eventId: string, input: ConfirmIndexInput) {
    const event = await this.getRequiredEvent(user, eventId);
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

  async importParticipants(
    user: AuthenticatedUser,
    eventId: string,
    input: ImportParticipantsJsonInput,
  ) {
    const event = await this.getRequiredEvent(user, eventId);

    if (event.status === EventStatus.archived) {
      throw new AppError(400, ErrorCodes.EVENT_NOT_ACTIVE, 'Cannot import participants to archived events');
    }

    // studentCode required, trim, unique trong cùng event
    const studentCodes = input.participants.map((p) => p.studentCode.trim());
    const uniqueCodes = new Set(studentCodes);
    if (uniqueCodes.size !== studentCodes.length) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'Duplicate studentCode found in import list');
    }

    const result = await prisma.$transaction(async (tx) => {
      if (input.mode === 'replace') {
        await tx.eventParticipant.deleteMany({ where: { eventId: event.id } });
      }

      for (const p of input.participants) {
        const trimmedCode = p.studentCode.trim();
        await tx.eventParticipant.upsert({
          where: {
            eventId_studentCode: {
              eventId: event.id,
              studentCode: trimmedCode,
            },
          },
          update: {
            studentName: p.fullName,
            className: p.className || null,
            faculty: p.faculty || null,
            participationStatus: p.attendanceStatus || 'confirmed',
            convertedValue: p.convertedValue || null,
          },
          create: {
            eventId: event.id,
            studentCode: trimmedCode,
            studentName: p.fullName,
            className: p.className || null,
            faculty: p.faculty || null,
            participationStatus: p.attendanceStatus || 'confirmed',
            convertedValue: p.convertedValue || null,
          },
        });
      }

      // Recalculate participantCount
      const totalParticipants = await tx.eventParticipant.count({
        where: { eventId: event.id },
      });

      await tx.eventRegistry.update({
        where: { id: event.id },
        data: {
          participantCount: totalParticipants,
          rosterIndexed: totalParticipants > 0 ? true : event.rosterIndexed,
        },
      });

      // Audit log
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: 'EVENT_PARTICIPANTS_IMPORTED',
        targetType: 'event',
        targetId: event.id,
        afterStateJson: { count: input.participants.length, mode: input.mode },
      });

      return {
        importedCount: input.participants.length,
        mode: input.mode,
        eventId: event.id,
      };
    });

    return result;
  }

  async checkParticipant(
    user: AuthenticatedUser,
    eventId: string,
    input: CheckParticipantInput,
  ) {
    const event = await this.getRequiredEvent(user, eventId);

    // Rule: Chỉ check event confirmed cho student.
    const isStudent = user.role === Role.student || user.role === Role.class_representative;
    if (isStudent) {
      if (event.status !== EventStatus.active) {
        throw new AppError(403, ErrorCodes.FORBIDDEN, 'Students can only check confirmed events');
      }
    }

    // Determine target studentCode
    let targetStudentCode = input.studentCode;
    if (!targetStudentCode) {
      if (isStudent) {
        targetStudentCode = user.studentCode || undefined;
      }
    }

    if (!targetStudentCode) {
      throw new AppError(400, ErrorCodes.STUDENT_CODE_REQUIRED, 'studentCode is required');
    }

    // Rule: Nếu requester là student và gửi studentCode khác mình, trả FORBIDDEN.
    if (isStudent) {
      if (targetStudentCode !== user.studentCode) {
        throw new AppError(403, ErrorCodes.FORBIDDEN, 'Students can only check their own student code');
      }
    }

    const participant = await prisma.eventParticipant.findUnique({
      where: {
        eventId_studentCode: {
          eventId: event.id,
          studentCode: targetStudentCode,
        },
      },
    });

    const isParticipant = Boolean(participant);

    // Audit only if requested or as a general log
    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        actorRole: user.role,
        workspaceId: event.workspaceId,
        action: 'EVENT_PARTICIPANT_CHECKED',
        targetType: 'event',
        targetId: event.id,
        afterStateJson: { found: isParticipant, studentCode: targetStudentCode },
      },
    });

    return {
      eventId: event.id,
      studentCode: targetStudentCode,
      isParticipant,
      participant: participant
        ? {
            id: participant.id,
            fullName: participant.studentName,
            className: participant.className,
            faculty: participant.faculty,
            attendanceStatus: participant.participationStatus || 'confirmed',
          }
        : null,
    };
  }

  async importToApplication(
    user: AuthenticatedUser,
    eventId: string,
    input: ImportToApplicationInput,
  ) {
    return this.importAsEvidence(user, eventId, {
      applicationId: input.applicationId,
      evidenceName: input.evidenceName,
      note: input.note,
    });
  }

  async importAsEvidence(user: AuthenticatedUser, eventId: string, input: ImportAsEvidenceInput) {
    return importEventAsEvidence({
      user,
      eventId,
      applicationId: input.applicationId,
      participantId: input.participantId,
      evidenceName: input.evidenceName,
      note: input.note,
    });
  }

  private async getRequiredEvent(user: AuthenticatedUser, eventId: string) {
    const event = await this.repository.findById(eventId);
    if (!event) throw new AppError(404, ErrorCodes.EVENT_NOT_FOUND, 'Event not found');
    assertSameWorkspace(user, event, 'Event not found');
    return event;
  }

  private assertCanViewEvent(user: AuthenticatedUser, event: EventRegistry): void {
    if (user.role === Role.student || user.role === Role.class_representative) {
      if (event.status !== EventStatus.active) {
        throw new AppError(403, ErrorCodes.FORBIDDEN, 'Students can only view confirmed events');
      }
    }
  }

  private toEventDto(
    event: EventRegistry & { eventFiles?: unknown[]; sampleCertificateFile?: unknown },
  ) {
    let apiStatus: 'draft' | 'confirmed' | 'archived' = 'draft';
    if (event.status === EventStatus.active) {
      apiStatus = 'confirmed';
    } else if (event.status === EventStatus.archived) {
      apiStatus = 'archived';
    }

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
      status: apiStatus,
      eventFiles: event.eventFiles,
      sampleCertificateFile: event.sampleCertificateFile,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    };
  }

}

// Owns evidence records, evidence files, indexing triggers, and evidence cards.
import {
  ApplicationStatus,
  EvidenceSourceType,
  EvidenceStatus,
  FileStorageType,
  IndexingStatus,
  JobStatus,
  JobType,
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
import {
  assertApplicationEditable,
  assertApplicationOwner,
  createApplicationAudit,
} from '../applications/application.helpers';
import { AuditService } from '../audit/audit.service';
import { JobsService } from '../jobs/jobs.service';
import { mapEvidenceUxStatus } from './evidence-ux-status.mapper';
import { EvidencesRepository } from './evidences.repository';
import type {
  CreateEvidenceInput,
  ListEvidencesQuery,
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
    if (user.role === Role.student || user.role === Role.class_representative) {
      assertApplicationOwner(application, user);
    } else if (
      user.role !== Role.officer &&
      user.role !== Role.manager &&
      user.role !== Role.admin
    ) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Role cannot create application evidence');
    }
    assertApplicationEditable(application);

    if (input.sourceType !== EvidenceSourceType.manual_upload) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'sourceType must be manual_upload for uploaded evidence');
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
            extractedFieldsJson: (input.metadata ?? {}) as any,
            warningsJson: [],
            confidence: 1.0,
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
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new AppError(
        400,
        ErrorCodes.FILE_TYPE_NOT_ALLOWED,
        'File type not allowed. Only JPEG, PNG, and PDF are allowed.',
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
    const safeOriginalName = sanitizeFileName(file.originalname);
    const objectKey = `applications/${applicationId}/evidences/${evidence.id}/${timestamp}-${safeOriginalName}`;

    // Upload via StorageService
    await this.storageService.uploadObject({
      key: objectKey,
      buffer: file.buffer,
      contentType: file.mimetype,
    });

    const result = await prisma.$transaction(async (tx) => {
      const originalName = body?.displayName || file.originalname;
      const fileRecord = await tx.file.create({
        data: {
          ownerId: user.id,
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
      await tx.evidenceFile.create({
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

      const existingJob = await tx.indexingJob.findFirst({
        where: {
          targetId: evidence.id,
          jobType: JobType.evidence_ocr,
          status: { in: [JobStatus.queued, JobStatus.processing] },
        },
        orderBy: { createdAt: 'desc' },
      });
      const job =
        existingJob ??
        (await tx.indexingJob.create({
          data: {
            targetId: evidence.id,
            jobType: JobType.evidence_ocr,
            status: JobStatus.queued,
            attempts: 0,
          },
        }));

      const updatedEvidence = await tx.evidence.update({
        where: { id: evidence.id },
        data: {
          status,
          indexingStatus,
        },
        include: {
          application: { include: { student: true } },
          collectiveProfile: true,
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
	    });

    return result;
  }

  async startIndexing(user: AuthenticatedUser, evidenceId: string, _input: StartIndexingInput) {
    const evidence = await this.getRequiredEvidence(evidenceId);
    this.assertCanViewEvidence(user, evidence);

    const { job, reused } = await this.jobsService.enqueueIndexingJob(evidence.id, JobType.evidence_ocr);
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
      card: evidence.evidenceCard
        ? this.toEvidenceCardDto(evidence, isPrivileged)
        : null,
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
    return this.evidencesRepository.findEvidenceAuditLogs?.(evidenceId, jobIds) ?? Promise.resolve([]);
  }

  private async getEvidenceAuditSummary(evidenceId: string) {
    const logs = await (this.evidencesRepository.findEvidenceAuditSummaryLogs?.(evidenceId) ?? Promise.resolve([]));
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
      fields: evidence.evidenceCard?.normalizedFieldsJson ?? evidence.evidenceCard?.extractedFieldsJson,
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
  ) {
    const card = evidence.evidenceCard;
    if (!card) return null;

    const fields = card.normalizedFieldsJson ?? card.extractedFieldsJson;
    const readableSummary = buildReadableSummary(fields);
    const warnings = mapWarnings(card.warningsJson);
    const missingFields = buildMissingFields(evidence.criterion, fields, card.warningsJson);
    const studentStatus = resolveStudentStatusForCard({
      sourceType: evidence.sourceType,
      status: evidence.status,
      indexingStatus: evidence.indexingStatus,
      criterion: evidence.criterion,
      ocrText: card.ocrText,
      fields,
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
      readableSummary,
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
      sourceEndpoint: card.sourceEndpoint,
      smartreaderJobId: card.smartreaderJobId,
      technicalSummary: card.aiSummary,
      rawAiResponse: card.rawAiResponse,
      rawResponseJson: card.rawResponseJson,
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
}

function previewText(value?: string | null): string | undefined {
  if (!value?.trim()) return undefined;
  return value.trim().replace(/\s+/g, ' ').slice(0, 240);
}

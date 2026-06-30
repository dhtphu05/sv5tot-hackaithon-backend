// Owns evidence records, evidence files, indexing triggers, and evidence cards.
import {
  EvidenceSourceType,
  EvidenceStatus,
  FileStorageType,
  IndexingStatus,
  JobType,
  Role,
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
import { JobsService, runIndexingJob } from '../jobs/jobs.service';
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
    private readonly storageService = new LocalStorageService(),
    private readonly jobsService = new JobsService(),
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
    assertApplicationOwner(application, user);
    assertApplicationEditable(application);

    const evidence = await prisma.$transaction(async (tx) => {
      const created = await tx.evidence.create({
        data: {
          applicationId,
          evidenceName: input.evidenceName,
          criterion: input.criterion,
          sourceType: EvidenceSourceType.manual_upload,
          status: EvidenceStatus.draft,
          indexingStatus: IndexingStatus.not_started,
        },
      });

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

  async delete(user: AuthenticatedUser, evidenceId: string) {
    const evidence = await this.getRequiredEvidence(evidenceId);
    assertApplicationOwner(evidence.application!, user);
    assertApplicationEditable(evidence.application!);

    const filePaths = evidence.evidenceFiles.map((link) => link.file.filePath);

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

    for (const filePath of filePaths) {
      await this.storageService.deleteFile(filePath);
    }

    return { deleted: true };
  }

  async uploadFile(user: AuthenticatedUser, evidenceId: string, file?: UploadedEvidenceFile) {
    if (!file) {
      throw new AppError(400, ErrorCodes.EVIDENCE_FILE_REQUIRED, 'Evidence file is required');
    }

    const evidence = await this.getRequiredEvidence(evidenceId);
    assertApplicationOwner(evidence.application!, user);
    assertApplicationEditable(evidence.application!);

    if (evidence.sourceType !== EvidenceSourceType.manual_upload) {
      throw new AppError(
        400,
        ErrorCodes.EVIDENCE_NOT_EDITABLE,
        'Evidence source is not uploadable',
      );
    }

    const storedFile = await this.storageService.saveFile({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      applicationId: evidence.applicationId!,
      evidenceId: evidence.id,
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

      const fileRole = evidence.evidenceFiles.length === 0 ? 'primary' : 'supporting';
      await tx.evidenceFile.create({
        data: {
          evidenceId: evidence.id,
          fileId: fileRecord.id,
          fileRole,
        },
      });

      const updatedEvidence = await tx.evidence.update({
        where: { id: evidence.id },
        data: {
          indexingStatus: IndexingStatus.uploaded,
          status: EvidenceStatus.pending_indexing,
        },
      });

      const job = await tx.indexingJob.create({
        data: {
          jobType: JobType.evidence_ocr,
          targetId: evidence.id,
          status: 'queued',
          attempts: 0,
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
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.EVIDENCE_FILE_UPLOADED,
        targetType: 'evidence',
        targetId: evidence.id,
        applicationId: evidence.applicationId,
        afterStateJson: { fileId: fileRecord.id, fileRole },
      });
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.INDEXING_JOB_CREATED,
        targetType: 'job',
        targetId: job.id,
        applicationId: evidence.applicationId,
        afterStateJson: { jobType: job.jobType, status: job.status },
      });

      return { evidence: updatedEvidence, file: fileRecord, job };
    });

    return result;
  }

  async startIndexing(user: AuthenticatedUser, evidenceId: string, input: StartIndexingInput) {
    const evidence = await this.getRequiredEvidence(evidenceId);
    this.assertCanViewEvidence(user, evidence);

    if (evidence.evidenceFiles.length === 0) {
      throw new AppError(400, ErrorCodes.EVIDENCE_FILE_REQUIRED, 'Evidence has no files');
    }

    if (evidence.indexingStatus === IndexingStatus.indexed && !input.force) {
      return {
        job: null,
        evidence: this.toEvidenceDto(evidence, user),
        card: evidence.evidenceCard,
      };
    }

    const existing = await this.jobsService.getActiveJobForTarget(
      evidence.id,
      JobType.evidence_ocr,
    );
    const job = existing
      ? existing
      : (await this.jobsService.enqueueIndexingJob(evidence.id, JobType.evidence_ocr)).job;

    if (input.runMode === 'sync') {
      const completedJob = await runIndexingJob(job.id);
      const refreshed = await this.getRequiredEvidence(evidence.id);
      return {
        job: completedJob,
        evidence: this.toEvidenceDto(refreshed, user),
      };
    }

    return {
      job,
      evidence: this.toEvidenceDto(evidence, user),
    };
  }

  async getCard(user: AuthenticatedUser, evidenceId: string) {
    const evidence = await this.getRequiredEvidence(evidenceId);
    this.assertCanViewEvidence(user, evidence);

    if (!evidence.evidenceCard) {
      return {
        card: null,
        indexingStatus: evidence.indexingStatus,
      };
    }

    const isPrivileged =
      user.role === Role.officer ||
      user.role === Role.manager ||
      user.role === Role.committee ||
      user.role === Role.admin;

    return {
      card: {
        id: evidence.evidenceCard.id,
        ocrText: evidence.evidenceCard.ocrText,
        extractedFieldsJson: evidence.evidenceCard.extractedFieldsJson,
        warningsJson: evidence.evidenceCard.warningsJson,
        matchedEventId: evidence.evidenceCard.matchedEventId,
        matchedKnowledgeItemIds: evidence.evidenceCard.matchedKnowledgeItemIds,
        confidence: evidence.evidenceCard.confidence,
        aiSummary: evidence.evidenceCard.aiSummary,
        rawAiResponse: isPrivileged ? evidence.evidenceCard.rawAiResponse : undefined,
        createdAt: evidence.evidenceCard.createdAt,
        updatedAt: evidence.evidenceCard.updatedAt,
      },
      indexingStatus: evidence.indexingStatus,
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

  private toEvidenceDto(
    evidence: NonNullable<Awaited<ReturnType<EvidencesRepository['findEvidence']>>>,
    _user: AuthenticatedUser,
  ) {
    return {
      id: evidence.id,
      applicationId: evidence.applicationId,
      evidenceName: evidence.evidenceName,
      criterion: evidence.criterion,
      sourceType: evidence.sourceType,
      status: evidence.status,
      indexingStatus: evidence.indexingStatus,
      confidence: evidence.confidence,
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
            confidence: evidence.evidenceCard.confidence,
            warnings: evidence.evidenceCard.warningsJson,
          }
        : null,
    };
  }
}

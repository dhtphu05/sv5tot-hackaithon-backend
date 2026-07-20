// Owns indexing and async job visibility plus processor registration.
import { DecisionImportStatus, EvidenceStatus, IndexingStatus, JobStatus, JobType, Prisma, Role, type IndexingJob } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { auditActions } from '../../shared/constants/application';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { assertSameWorkspace } from '../../shared/utils/workspace-scope';
import { createApplicationAudit } from '../applications/application.helpers';
import { mapEvidenceUxStatus } from '../evidences/evidence-ux-status.mapper';
import { JobsRepository } from './jobs.repository';
import { processDecisionMetadataJob } from './processors/decision-metadata.processor';
import { processDecisionRosterOcrJob } from './processors/decision-roster-ocr.processor';
import { processEventRosterIndexingJob } from './processors/event-roster-indexing.processor';
import { processEvidenceOcrJob } from './processors/evidence-ocr.processor';

export class JobsService {
  constructor(private readonly jobsRepository = new JobsRepository()) {}

  async enqueueIndexingJob(targetId: string, jobType: JobType, workspaceId?: string | null) {
    const existing = await this.jobsRepository.getActiveJobForTarget(targetId, jobType, workspaceId);
    if (existing) {
      return { job: existing, reused: true };
    }

    const job = await this.jobsRepository.enqueueIndexingJob(targetId, jobType, workspaceId);
    return { job, reused: false };
  }

  getActiveJobForTarget(targetId: string, jobType: JobType) {
    return this.jobsRepository.getActiveJobForTarget(targetId, jobType);
  }

  async getJob(user: AuthenticatedUser, jobId: string) {
    const job = await this.getRequiredJob(jobId);
    await this.assertCanViewJob(user, job);
    return this.toJobDto(job);
  }

  async runJob(user: AuthenticatedUser, jobId: string) {
    const job = await this.getRequiredJob(jobId);
    await this.assertCanViewJob(user, job);

    if (user.role !== Role.manager && user.role !== Role.admin) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Role cannot run this job');
    }

    return runIndexingJob(job.id);
  }

  async retryJob(user: AuthenticatedUser, jobId: string) {
    const job = await this.getRequiredJob(jobId);
    await this.assertCanViewJob(user, job);

    if (job.status !== JobStatus.failed) {
      throw new AppError(409, ErrorCodes.CONFLICT, 'Only failed jobs can be retried');
    }

    const evidence = await prisma.evidence.findUnique({
      where: { id: job.targetId },
      include: {
        application: { include: { student: true } },
        collectiveProfile: { include: { representative: true } },
      },
    });

    const retried = await prisma.$transaction(async (tx) => {
      const updated = await tx.indexingJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.queued,
          errorMessage: null,
          resultJson: Prisma.JsonNull,
        },
      });

      if (evidence) {
        await tx.evidence.update({
          where: { id: evidence.id },
          data: {
            status: EvidenceStatus.pending_indexing,
            indexingStatus: IndexingStatus.pending_indexing,
          },
        });
        await createApplicationAudit(tx, {
          actorId: user.id,
          actorRole: user.role,
          workspaceId: evidence.application?.workspaceId ?? evidence.collectiveProfile?.workspaceId,
          action: auditActions.EVIDENCE_INDEXING_RETRIED,
          targetType: 'indexing_job',
          targetId: updated.id,
          applicationId: evidence.applicationId ?? undefined,
          collectiveProfileId: evidence.collectiveProfileId ?? undefined,
          afterStateJson: {
            jobId: updated.id,
            previousStatus: job.status,
            nextStatus: updated.status,
            attempts: updated.attempts,
          },
        });
      }

      return updated;
    });

    return this.toJobDto(retried);
  }

  async runWorkerTick() {
    const job = await this.jobsRepository.findNextQueuedJob();
    if (!job) {
      return { processed: 0, job: null };
    }

    const completed = await runIndexingJob(job.id);
    return { processed: 1, job: completed };
  }

  private async getRequiredJob(jobId: string) {
    const job = await this.jobsRepository.findById(jobId);
    if (!job) {
      throw new AppError(404, ErrorCodes.JOB_NOT_FOUND, 'Job not found');
    }
    return job;
  }

  private async assertCanViewJob(user: AuthenticatedUser, job: IndexingJob): Promise<void> {
    if (user.role === Role.admin) {
      return;
    }

    const evidence = await prisma.evidence.findUnique({
      where: { id: job.targetId },
      include: { application: true, collectiveProfile: true },
    });

    const decisionImport = await prisma.decisionImport.findUnique({ where: { id: job.targetId } });
    const targetWorkspaceId = resolveTargetWorkspaceId(evidence, decisionImport);
    assertJobWorkspaceMatchesTarget(job, targetWorkspaceId);
    const resolvedWorkspaceId = targetWorkspaceId ?? job.workspaceId ?? null;
    if (
      user.role === Role.manager ||
      user.role === Role.officer ||
      user.role === Role.committee
    ) {
      assertSameWorkspace(user, { workspaceId: resolvedWorkspaceId }, 'Job not found');
      return;
    }
    if (decisionImport) {
      throw new AppError(404, ErrorCodes.JOB_NOT_FOUND, 'Job not found');
    }

    const ownerId =
      evidence?.application?.studentId ?? evidence?.collectiveProfile?.representativeId;
    if (!evidence || ownerId !== user.id) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Job belongs to another user');
    }
    assertSameWorkspace(user, { workspaceId: resolvedWorkspaceId }, 'Job not found');
  }

  private async toJobDto(job: IndexingJob) {
    const evidence = await prisma.evidence.findUnique({
      where: { id: job.targetId },
      include: { evidenceCard: true },
    });
    const smartReaderJob = await prisma.smartReaderJob.findFirst({
      where: { evidenceId: job.targetId },
      orderBy: { createdAt: 'desc' },
    });
    const uxStatus = evidence
      ? mapEvidenceUxStatus({
          evidenceStatus: evidence.status,
          indexingStatus: evidence.indexingStatus,
          jobStatus: job.status,
          smartReaderStatus: smartReaderJob?.status,
          hasCard: !!evidence.evidenceCard,
          confidence: evidence.confidence,
        })
      : null;

    return {
      id: job.id,
      jobType: job.jobType,
      targetId: job.targetId,
      status: job.status,
      attempts: job.attempts,
      errorMessage: job.errorMessage,
      resultJson: job.resultJson,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      provider: smartReaderJob?.provider ?? (job.jobType === JobType.evidence_ocr ? 'vnpt_smartreader' : null),
      smartreaderJobId: smartReaderJob?.id ?? null,
      progress: {
        processedPages: smartReaderJob?.progressProcessedPages ?? null,
        remainingPages: smartReaderJob?.progressRemainingPages ?? null,
        status: smartReaderJob?.status ?? null,
      },
      retryable: job.status === JobStatus.failed,
      uxStatus,
    };
  }
}

export async function runIndexingJob(jobId: string) {
  const job = await prisma.indexingJob.findUnique({ where: { id: jobId } });
  if (!job) {
    throw new AppError(404, ErrorCodes.JOB_NOT_FOUND, 'Job not found');
  }

  const evidence = await prisma.evidence.findUnique({
    where: { id: job.targetId },
    include: {
      application: { include: { student: true } },
      collectiveProfile: { include: { representative: true } },
    },
  });
  const decisionImport = await prisma.decisionImport.findUnique({ where: { id: job.targetId } });
  assertJobWorkspaceMatchesTarget(job, resolveTargetWorkspaceId(evidence, decisionImport));

  if (job.status === JobStatus.processing) {
    throw new AppError(409, ErrorCodes.JOB_ALREADY_RUNNING, 'Job is already running');
  }

  const processingJob = await prisma.indexingJob.update({
    where: { id: job.id },
    data: {
      status: JobStatus.processing,
      attempts: { increment: 1 },
      errorMessage: null,
    },
  });

  if (evidence) {
    const actor = evidence.application?.student ?? evidence.collectiveProfile?.representative;
    await createApplicationAudit(prisma, {
      actorId: actor?.id,
      actorRole: actor?.role,
      workspaceId: evidence.application?.workspaceId ?? evidence.collectiveProfile?.workspaceId,
      action: auditActions.OCR_JOB_PROCESSING,
      targetType: 'indexing_job',
      targetId: processingJob.id,
      applicationId: evidence.applicationId ?? undefined,
      collectiveProfileId: evidence.collectiveProfileId ?? undefined,
      afterStateJson: {
        jobId: processingJob.id,
        jobType: processingJob.jobType,
        attempts: processingJob.attempts,
      },
    });
    await createApplicationAudit(prisma, {
      actorId: actor?.id,
      actorRole: actor?.role,
      workspaceId: evidence.application?.workspaceId ?? evidence.collectiveProfile?.workspaceId,
      action: auditActions.EVIDENCE_INDEXING_STARTED,
      targetType: 'evidence',
      targetId: evidence.id,
      applicationId: evidence.applicationId ?? undefined,
      collectiveProfileId: evidence.collectiveProfileId ?? undefined,
    });
  }

  try {
    const resultJson =
      processingJob.jobType === JobType.evidence_ocr
        ? await processEvidenceOcrJob(processingJob)
        : processingJob.jobType === JobType.event_roster_indexing
          ? await processEventRosterIndexingJob(processingJob)
          : processingJob.jobType === JobType.decision_metadata
            ? await processDecisionMetadataJob(processingJob)
            : processingJob.jobType === JobType.decision_roster_ocr
              ? await processDecisionRosterOcrJob(processingJob)
              : { message: 'Unsupported job type' };

    const completed = await prisma.indexingJob.update({
      where: { id: processingJob.id },
      data: {
        status: JobStatus.completed,
        resultJson,
      },
    });

    if (evidence) {
      const actor = evidence.application?.student ?? evidence.collectiveProfile?.representative;
      await createApplicationAudit(prisma, {
        actorId: actor?.id,
        actorRole: actor?.role,
        workspaceId: evidence.application?.workspaceId ?? evidence.collectiveProfile?.workspaceId,
        action: auditActions.EVIDENCE_INDEXING_COMPLETED,
        targetType: 'evidence',
        targetId: evidence.id,
        applicationId: evidence.applicationId ?? undefined,
        collectiveProfileId: evidence.collectiveProfileId ?? undefined,
        afterStateJson: resultJson,
      });
    }

    if (processingJob.jobType === JobType.decision_metadata || processingJob.jobType === JobType.decision_roster_ocr) {
      await prisma.decisionImport.update({
        where: { id: processingJob.targetId },
        data: {
          lastErrorCode: null,
          lastErrorMessage: null,
          lastUserMessage: null,
        },
      }).catch(() => undefined);
    }

    return completed;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown job failure';
    const code = error instanceof AppError ? error.code : ErrorCodes.JOB_FAILED;
    const retryable = error instanceof AppError
      ? Boolean((error.details as { retryable?: boolean } | undefined)?.retryable)
      : true;
    const failed = await prisma.indexingJob.update({
      where: { id: processingJob.id },
      data: {
        status: JobStatus.failed,
        errorMessage: message,
        resultJson: { code, retryable, message },
      },
    });

    if (evidence) {
      const actor = evidence.application?.student ?? evidence.collectiveProfile?.representative;
      const manualReview = code === ErrorCodes.OCR_EMPTY_TEXT;
      await prisma.evidence.update({
        where: { id: evidence.id },
        data: manualReview
          ? { indexingStatus: IndexingStatus.needs_manual_review, status: EvidenceStatus.needs_supplement }
          : { indexingStatus: IndexingStatus.failed },
      });
      await createApplicationAudit(prisma, {
        actorId: actor?.id,
        actorRole: actor?.role,
        workspaceId: evidence.application?.workspaceId ?? evidence.collectiveProfile?.workspaceId,
        action: auditActions.EVIDENCE_INDEXING_FAILED,
        targetType: 'evidence',
        targetId: evidence.id,
        applicationId: evidence.applicationId ?? undefined,
        collectiveProfileId: evidence.collectiveProfileId ?? undefined,
        afterStateJson: { code, retryable, error: message },
      });
    }

    if (processingJob.jobType === JobType.decision_metadata || processingJob.jobType === JobType.decision_roster_ocr) {
      const decisionFailureData =
        processingJob.jobType === JobType.decision_metadata
          ? {
              status: DecisionImportStatus.ocr_processing,
              lastErrorCode: code,
              lastErrorMessage: message,
              lastUserMessage:
                'Không trích xuất được metadata văn bản hành chính từ VNPT; vẫn tiếp tục OCR danh sách.',
              processingStep: 'metadata_failed_roster_pending',
            }
          : {
              status: DecisionImportStatus.failed,
              lastErrorCode: code,
              lastErrorMessage: message,
              lastUserMessage: message,
              processingStep: 'failed',
            };
      await prisma.decisionImport.update({
        where: { id: processingJob.targetId },
        data: decisionFailureData,
      }).catch(() => undefined);
      await createApplicationAudit(prisma, {
        action: auditActions.SMARTREADER_OCR_FAILED,
        targetType: 'decision_import',
        targetId: processingJob.targetId,
        afterStateJson: { code, retryable, error: message, jobId: processingJob.id },
      });
    }

    return failed;
  }
}

function resolveTargetWorkspaceId(
  evidence:
    | {
        application?: { workspaceId: string } | null;
        collectiveProfile?: { workspaceId: string } | null;
      }
    | null,
  decisionImport: { workspaceId: string } | null,
) {
  return (
    evidence?.application?.workspaceId ??
    evidence?.collectiveProfile?.workspaceId ??
    decisionImport?.workspaceId ??
    null
  );
}

function assertJobWorkspaceMatchesTarget(
  job: Pick<IndexingJob, 'workspaceId'>,
  targetWorkspaceId: string | null,
) {
  if (job.workspaceId && targetWorkspaceId && job.workspaceId !== targetWorkspaceId) {
    throw new AppError(404, ErrorCodes.JOB_NOT_FOUND, 'Job not found');
  }
}

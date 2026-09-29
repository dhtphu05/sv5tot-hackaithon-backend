// Owns indexing and async job visibility plus processor registration.
import { DecisionImportStatus, EvidenceStatus, IndexingStatus, JobStatus, JobType, Prisma, Role, type IndexingJob } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../infrastructure/database/prisma';
import { auditActions } from '../../shared/constants/application';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { assertSameWorkspace } from '../../shared/utils/workspace-scope';
import { createApplicationAudit } from '../applications/application.helpers';
import { lockApplicationAndReadCancellationState } from '../applications/application-lifecycle.policy';
import { mapEvidenceUxStatus } from '../evidences/evidence-ux-status.mapper';
import { parseEvidenceAnalysisJobInput } from './evidence-analysis-job-input';
import { JobsRepository } from './jobs.repository';
import { processDecisionMetadataJob } from './processors/decision-metadata.processor';
import { processDecisionRosterOcrJob } from './processors/decision-roster-ocr.processor';
import { processEventRosterIndexingJob } from './processors/event-roster-indexing.processor';
import { processEvidenceOcrJob } from './processors/evidence-ocr.processor';
import { processAwardRosterIngestionJob } from './processors/award-roster-ingestion.processor';
import { getJobFailureTransition, isJobFailureRetryable } from './job-retry-policy';

export class JobsService {
  constructor(private readonly jobsRepository = new JobsRepository()) {}

  async enqueueIndexingJob(
    targetId: string,
    jobType: JobType,
    workspaceId?: string | null,
    inputJson?: Prisma.InputJsonValue,
    tx?: Prisma.TransactionClient,
  ) {
    const active = await this.jobsRepository.getActiveJobsForTarget(targetId, jobType, workspaceId, tx);
    const existing = inputJson
      ? active.find((job) => {
          try {
            const current = parseEvidenceAnalysisJobInput(job.inputJson);
            const next = parseEvidenceAnalysisJobInput(inputJson);
            return current.evidenceFileId === next.evidenceFileId && current.fileId === next.fileId;
          } catch {
            return false;
          }
        })
      : active[0];
    if (existing) {
      return { job: existing, reused: true };
    }

    const job = await this.jobsRepository.enqueueIndexingJob(targetId, jobType, workspaceId, inputJson, tx);
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
    if (!isJobFailureRetryable(job.resultJson)) {
      throw new AppError(409, ErrorCodes.CONFLICT, 'This job failure is not retryable');
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
          attempts: 0,
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
    await this.jobsRepository.recoverStaleJobs();
    const jobs = await this.jobsRepository.claimQueuedJobs(env.JOB_WORKER_CONCURRENCY);
    if (!jobs.length) return { processed: 0, job: null, jobs: [] };

    const results = await Promise.allSettled(jobs.map((job) => processClaimedIndexingJob(job)));
    const processed = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    return {
      processed: jobs.length,
      job: processed.at(-1) ?? null,
      jobs: processed,
    };
  }

  private async getRequiredJob(jobId: string) {
    const job = await this.jobsRepository.findById(jobId);
    if (!job) {
      throw new AppError(404, ErrorCodes.JOB_NOT_FOUND, 'Job not found');
    }
    return job;
  }

  private async assertCanViewJob(user: AuthenticatedUser, job: IndexingJob): Promise<void> {
    if (job.jobType === JobType.award_roster_ingestion) {
      throw new AppError(404, ErrorCodes.JOB_NOT_FOUND, 'Job not found');
    }
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
      provider: evidence?.evidenceCard?.provider ?? smartReaderJob?.provider ?? null,
      smartreaderJobId: smartReaderJob?.id ?? null,
      progress: {
        processedPages: smartReaderJob?.progressProcessedPages ?? null,
        remainingPages: smartReaderJob?.progressRemainingPages ?? null,
        status: smartReaderJob?.status ?? null,
      },
      retryable: job.status === JobStatus.failed && isJobFailureRetryable(job.resultJson),
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
  const awardDecision =
    job.jobType === JobType.award_roster_ingestion
      ? await prisma.awardDecision.findUnique({ where: { id: job.targetId }, select: { issuerWorkspaceId: true } })
      : null;
  assertJobWorkspaceMatchesTarget(
    job,
    resolveTargetWorkspaceId(evidence, decisionImport, awardDecision),
    job.jobType === JobType.award_roster_ingestion,
  );

  if (job.status === JobStatus.processing) {
    throw new AppError(409, ErrorCodes.JOB_ALREADY_RUNNING, 'Job is already running');
  }

  if (job.status !== JobStatus.queued) {
    throw new AppError(409, ErrorCodes.CONFLICT, 'Only queued jobs can be run directly');
  }

  const processingJob = await new JobsRepository().claimQueuedJobById(job.id);
  if (!processingJob) {
    throw new AppError(409, ErrorCodes.JOB_ALREADY_RUNNING, 'Job was already claimed');
  }

  return processClaimedIndexingJob(processingJob);
}

async function processClaimedIndexingJob(processingJob: IndexingJob) {
  const evidence = await prisma.evidence.findUnique({
    where: { id: processingJob.targetId },
    include: {
      application: { include: { student: true } },
      collectiveProfile: { include: { representative: true } },
    },
  });
  const decisionImport = await prisma.decisionImport.findUnique({ where: { id: processingJob.targetId } });
  const awardDecision =
    processingJob.jobType === JobType.award_roster_ingestion
      ? await prisma.awardDecision.findUnique({ where: { id: processingJob.targetId }, select: { issuerWorkspaceId: true } })
      : null;
  assertJobWorkspaceMatchesTarget(
    processingJob,
    resolveTargetWorkspaceId(evidence, decisionImport, awardDecision),
    processingJob.jobType === JobType.award_roster_ingestion,
  );

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
              : processingJob.jobType === JobType.award_roster_ingestion
                ? await processAwardRosterIngestionJob(processingJob)
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
      await prisma.decisionImport.updateMany({
        where: {
          id: processingJob.targetId,
          ...(processingJob.jobType === JobType.decision_metadata
            ? { metadataJobId: processingJob.id }
            : { rosterJobId: processingJob.id }),
        },
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
    const transition = getJobFailureTransition({
      retryable,
      attempts: processingJob.attempts,
      maxAttempts: env.JOB_WORKER_MAX_ATTEMPTS,
    });
    const failureTelemetry = error instanceof AppError && error.details && typeof error.details === 'object'
      ? (error.details as { telemetry?: Prisma.InputJsonValue }).telemetry
      : undefined;
    const failed = await prisma.indexingJob.update({
      where: { id: processingJob.id },
      data: {
        status: transition.status,
        errorMessage: message,
        resultJson: {
          code,
          retryable: transition.retryable,
          message,
          ...(failureTelemetry ? { telemetry: failureTelemetry } : {}),
        },
      },
    });

    if (evidence) {
      const actor = evidence.application?.student ?? evidence.collectiveProfile?.representative;
      const manualReview =
        code === ErrorCodes.OCR_EMPTY_TEXT || code === ErrorCodes.EMPTY_EVIDENCE_DOCUMENT;
      await prisma.$transaction(async (tx) => {
        const applicationCancelled = evidence.applicationId
          ? await lockApplicationAndReadCancellationState(tx, evidence.applicationId)
          : false;
        await tx.evidence.update({
          where: { id: evidence.id },
          data: transition.status === JobStatus.queued
            ? { indexingStatus: IndexingStatus.pending_indexing, status: EvidenceStatus.pending_indexing }
            : manualReview
              ? applicationCancelled
                ? { indexingStatus: IndexingStatus.needs_manual_review }
                : { indexingStatus: IndexingStatus.needs_manual_review, status: EvidenceStatus.needs_supplement }
              : { indexingStatus: IndexingStatus.failed },
        });
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

    if (processingJob.jobType === JobType.event_roster_indexing && transition.status === JobStatus.queued) {
      const currentEventFile = await prisma.eventFile.findUnique({
        where: { id: processingJob.targetId },
        select: { fileId: true },
      });
      if (currentEventFile) {
        await prisma.eventFile.updateMany({
          where: { id: processingJob.targetId, fileId: currentEventFile.fileId, indexingStatus: IndexingStatus.failed },
          data: { indexingStatus: IndexingStatus.pending_indexing },
        });
      }
    }

    if (processingJob.jobType === JobType.decision_metadata || processingJob.jobType === JobType.decision_roster_ocr) {
      const pointer = processingJob.jobType === JobType.decision_metadata
        ? { metadataJobId: processingJob.id }
        : { rosterJobId: processingJob.id };
      const decisionFailureData =
        processingJob.jobType === JobType.decision_metadata
          ? {
              status: DecisionImportStatus.ocr_processing,
              lastErrorCode: code,
              lastErrorMessage: message,
              lastUserMessage: 'Không trích xuất được thông tin văn bản; vẫn tiếp tục xử lý danh sách.',
              processingStep: 'metadata_failed_roster_pending',
            }
          : {
              status: transition.status === JobStatus.queued ? DecisionImportStatus.ocr_processing : DecisionImportStatus.failed,
              lastErrorCode: code,
              lastErrorMessage: message,
              lastUserMessage: transition.status === JobStatus.queued
                ? 'Danh sách đang chờ worker thử lại.'
                : 'Không thể trích xuất danh sách. Vui lòng thử lại hoặc kiểm tra tệp.',
              processingStep: transition.status === JobStatus.queued ? 'roster_retry_pending' : 'failed',
            };
      const currentImport = await prisma.decisionImport.updateMany({
        where: { id: processingJob.targetId, ...pointer },
        data: decisionFailureData,
      }).catch(() => undefined);
      if (currentImport?.count) {
        await createApplicationAudit(prisma, {
          action: auditActions.DECISION_OPENAI_EXTRACTION_FAILED,
          targetType: 'decision_import',
          targetId: processingJob.targetId,
          afterStateJson: {
            provider: 'openai',
            useCase: processingJob.jobType === JobType.decision_metadata ? 'decision_metadata' : 'decision_roster',
            code,
            retryable,
            jobId: processingJob.id,
            ...(failureTelemetry ? { telemetry: failureTelemetry } : {}),
          },
        });
      }
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
  awardDecision: { issuerWorkspaceId: string } | null = null,
) {
  return (
    evidence?.application?.workspaceId ??
    evidence?.collectiveProfile?.workspaceId ??
    decisionImport?.workspaceId ??
    awardDecision?.issuerWorkspaceId ??
    null
  );
}

function assertJobWorkspaceMatchesTarget(
  job: Pick<IndexingJob, 'workspaceId'>,
  targetWorkspaceId: string | null,
  requireMatch = false,
) {
  if (requireMatch && (!job.workspaceId || !targetWorkspaceId || job.workspaceId !== targetWorkspaceId)) {
    throw new AppError(404, ErrorCodes.JOB_NOT_FOUND, 'Job not found');
  }
  if (job.workspaceId && targetWorkspaceId && job.workspaceId !== targetWorkspaceId) {
    throw new AppError(404, ErrorCodes.JOB_NOT_FOUND, 'Job not found');
  }
}

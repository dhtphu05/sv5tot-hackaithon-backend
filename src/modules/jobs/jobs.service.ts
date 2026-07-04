// Owns indexing and async job visibility plus processor registration.
import { JobStatus, JobType, Role, type IndexingJob } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { auditActions } from '../../shared/constants/application';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { createApplicationAudit } from '../applications/application.helpers';
import { JobsRepository } from './jobs.repository';
import { processEventRosterIndexingJob } from './processors/event-roster-indexing.processor';
import { processEvidenceOcrJob } from './processors/evidence-ocr.processor';

export class JobsService {
  constructor(private readonly jobsRepository = new JobsRepository()) {}

  async enqueueIndexingJob(targetId: string, jobType: JobType) {
    const existing = await this.jobsRepository.getActiveJobForTarget(targetId, jobType);
    if (existing) {
      return { job: existing, reused: true };
    }

    const job = await this.jobsRepository.enqueueIndexingJob(targetId, jobType);
    return { job, reused: false };
  }

  getActiveJobForTarget(targetId: string, jobType: JobType) {
    return this.jobsRepository.getActiveJobForTarget(targetId, jobType);
  }

  async getJob(user: AuthenticatedUser, jobId: string) {
    const job = await this.getRequiredJob(jobId);
    await this.assertCanViewJob(user, job);
    return job;
  }

  async runJob(user: AuthenticatedUser, jobId: string) {
    const job = await this.getRequiredJob(jobId);

    if (user.role !== Role.manager && user.role !== Role.admin && user.role !== Role.student) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Role cannot run this job');
    }

    return runIndexingJob(job.id);
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
    if (
      user.role === Role.manager ||
      user.role === Role.admin ||
      user.role === Role.officer ||
      user.role === Role.committee
    ) {
      return;
    }

    const evidence = await prisma.evidence.findUnique({
      where: { id: job.targetId },
      include: { application: true, collectiveProfile: true },
    });

    const ownerId =
      evidence?.application?.studentId ?? evidence?.collectiveProfile?.representativeId;
    if (!evidence || ownerId !== user.id) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Job belongs to another user');
    }
  }
}

export async function runIndexingJob(jobId: string) {
  const job = await prisma.indexingJob.findUnique({ where: { id: jobId } });
  if (!job) {
    throw new AppError(404, ErrorCodes.JOB_NOT_FOUND, 'Job not found');
  }

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

  const evidence = await prisma.evidence.findUnique({
    where: { id: job.targetId },
    include: {
      application: { include: { student: true } },
      collectiveProfile: { include: { representative: true } },
    },
  });

  if (evidence) {
    const actor = evidence.application?.student ?? evidence.collectiveProfile?.representative;
    await createApplicationAudit(prisma, {
      actorId: actor?.id,
      actorRole: actor?.role,
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
        action: auditActions.EVIDENCE_INDEXING_COMPLETED,
        targetType: 'evidence',
        targetId: evidence.id,
        applicationId: evidence.applicationId ?? undefined,
        collectiveProfileId: evidence.collectiveProfileId ?? undefined,
        afterStateJson: resultJson,
      });
    }

    return completed;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown job failure';
    const failed = await prisma.indexingJob.update({
      where: { id: processingJob.id },
      data: {
        status: JobStatus.failed,
        errorMessage: message,
      },
    });

    if (evidence) {
      const actor = evidence.application?.student ?? evidence.collectiveProfile?.representative;
      await prisma.evidence.update({
        where: { id: evidence.id },
        data: { indexingStatus: 'failed' },
      });
      await createApplicationAudit(prisma, {
        actorId: actor?.id,
        actorRole: actor?.role,
        action: auditActions.EVIDENCE_INDEXING_FAILED,
        targetType: 'evidence',
        targetId: evidence.id,
        applicationId: evidence.applicationId ?? undefined,
        collectiveProfileId: evidence.collectiveProfileId ?? undefined,
        afterStateJson: { error: message },
      });
    }

    return failed;
  }
}

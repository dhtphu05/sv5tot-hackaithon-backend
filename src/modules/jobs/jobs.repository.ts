// Owns indexing and async job visibility plus processor registration.
import { JobStatus, type JobType, type Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';

export class JobsRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  getActiveJobForTarget(targetId: string, jobType: JobType, workspaceId?: string | null) {
    return this.db.indexingJob.findFirst({
      where: {
        ...(workspaceId ? { workspaceId } : {}),
        targetId,
        jobType,
        status: { in: [JobStatus.queued, JobStatus.processing] },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  getActiveJobsForTarget(targetId: string, jobType: JobType, workspaceId?: string | null) {
    return this.db.indexingJob.findMany({
      where: {
        ...(workspaceId ? { workspaceId } : {}),
        targetId,
        jobType,
        status: { in: [JobStatus.queued, JobStatus.processing] },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  enqueueIndexingJob(
    targetId: string,
    jobType: JobType,
    workspaceId?: string | null,
    inputJson?: Prisma.InputJsonValue,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.db;
    return client.indexingJob.create({
      data: {
        targetId,
        workspaceId,
        jobType,
        status: JobStatus.queued,
        attempts: 0,
        inputJson,
      },
    });
  }

  findById(id: string) {
    return this.db.indexingJob.findUnique({ where: { id } });
  }

  findNextQueuedJob() {
    return this.db.indexingJob.findFirst({
      where: { status: JobStatus.queued },
      orderBy: { createdAt: 'asc' },
    });
  }

  async claimNextQueuedJob() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = await this.findNextQueuedJob();
      if (!candidate) return null;
      const updated = await this.db.indexingJob.updateMany({
        where: { id: candidate.id, status: JobStatus.queued },
        data: {
          status: JobStatus.processing,
          attempts: { increment: 1 },
          errorMessage: null,
        },
      });
      if (updated.count === 1) {
        return this.findById(candidate.id);
      }
    }
    return null;
  }

  async claimQueuedJobById(id: string) {
    const updated = await this.db.indexingJob.updateMany({
      where: { id, status: JobStatus.queued },
      data: {
        status: JobStatus.processing,
        attempts: { increment: 1 },
        errorMessage: null,
      },
    });
    if (updated.count !== 1) return null;
    return this.findById(id);
  }
}

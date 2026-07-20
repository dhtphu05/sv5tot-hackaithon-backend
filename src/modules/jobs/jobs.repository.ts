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

  enqueueIndexingJob(
    targetId: string,
    jobType: JobType,
    workspaceId?: string | null,
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
}

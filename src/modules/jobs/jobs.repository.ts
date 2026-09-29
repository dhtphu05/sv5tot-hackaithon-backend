// Owns indexing and async job visibility plus processor registration.
import { JobStatus, type IndexingJob, type JobType, type Prisma, type PrismaClient } from '@prisma/client';
import { env } from '../../config/env';
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

  getActiveJobsForTarget(
    targetId: string,
    jobType: JobType,
    workspaceId?: string | null,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.db;
    return client.indexingJob.findMany({
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
    return (await this.claimQueuedJobs(1))[0] ?? null;
  }

  async claimQueuedJobs(limit = env.JOB_WORKER_CONCURRENCY, onlyIds?: string[]) {
    const boundedLimit = Math.max(1, Math.min(10, Math.trunc(limit)));
    return this.db.$queryRaw<IndexingJob[]>`
      WITH due_jobs AS (
        SELECT "id"
        FROM "IndexingJob"
        WHERE "status" = 'queued'::"JobStatus"
          AND (${onlyIds === undefined} OR "id" = ANY(string_to_array(${onlyIds?.join(',') ?? ''}, ',')::uuid[]))
          AND (
            COALESCE("resultJson"->>'retryable', 'false') <> 'true'
            OR "updatedAt" <= CURRENT_TIMESTAMP - (
              LEAST(
                ${env.JOB_WORKER_RETRY_MAX_DELAY_MS},
                ${env.JOB_WORKER_RETRY_BASE_DELAY_MS} * POWER(2, GREATEST("attempts" - 1, 0))
              ) * INTERVAL '1 millisecond'
            )
          )
        ORDER BY "createdAt" ASC
        LIMIT ${boundedLimit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "IndexingJob" AS job
      SET "status" = 'processing'::"JobStatus",
          "attempts" = job."attempts" + 1,
          "errorMessage" = NULL,
          "updatedAt" = CURRENT_TIMESTAMP
      FROM due_jobs
      WHERE job."id" = due_jobs."id"
      RETURNING job.*
    `;
  }

  async recoverStaleJobs(onlyIds?: string[]) {
    const staleJobs = await this.db.$queryRaw<Array<{ id: string }>>`
      WITH stale_jobs AS (
        SELECT "id", "attempts"
        FROM "IndexingJob"
        WHERE "status" = 'processing'::"JobStatus"
          AND (${onlyIds === undefined} OR "id" = ANY(string_to_array(${onlyIds?.join(',') ?? ''}, ',')::uuid[]))
          AND "updatedAt" <= CURRENT_TIMESTAMP - (${env.JOB_WORKER_STALE_AFTER_MS} * INTERVAL '1 millisecond')
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "IndexingJob" AS job
      SET "status" = CASE
            WHEN stale_jobs."attempts" < ${env.JOB_WORKER_MAX_ATTEMPTS}
              THEN 'queued'::"JobStatus"
            ELSE 'failed'::"JobStatus"
          END,
          "errorMessage" = 'Worker lease expired before job completion',
          "resultJson" = jsonb_build_object(
            'code', 'JOB_WORKER_STALE',
            'retryable', stale_jobs."attempts" < ${env.JOB_WORKER_MAX_ATTEMPTS}
          ),
          "updatedAt" = CURRENT_TIMESTAMP
      FROM stale_jobs
      WHERE job."id" = stale_jobs."id"
      RETURNING job."id"
    `;
    return staleJobs.length;
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

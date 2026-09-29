import { randomUUID } from 'node:crypto';
import { JobStatus, JobType } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { prisma } from '../../src/infrastructure/database/prisma';
import { JobsRepository } from '../../src/modules/jobs/jobs.repository';

const workerTestUrl = process.env.WORKER_TEST_DATABASE_URL;
const safeWorkerTest = workerTestUrl ? describe : describe.skip;
const fixtureIds: string[] = [];
const fixturePrefix = `worker-test-${randomUUID()}`;

function requireDisposableWorkerDatabase() {
  if (!workerTestUrl) return;
  if (process.env.DATABASE_URL !== workerTestUrl) {
    throw new Error('Set DATABASE_URL to exactly the explicitly designated WORKER_TEST_DATABASE_URL');
  }
  const host = new URL(workerTestUrl).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error('Worker concurrency integration tests require a local disposable PostgreSQL database');
  }
}

async function createJob(status: JobStatus, attempts = 0, updatedAt = new Date()) {
  const job = await prisma.indexingJob.create({
    data: {
      workspaceId: null,
      jobType: JobType.evidence_ocr,
      targetId: randomUUID(),
      status,
      attempts,
      updatedAt,
      inputJson: { workerFixture: fixturePrefix },
    },
  });
  fixtureIds.push(job.id);
  return job;
}

safeWorkerTest('PostgreSQL worker claim and stale recovery', () => {
  it('does not double-claim rows across workers and recovers only stale leases', async () => {
    requireDisposableWorkerDatabase();
    await prisma.$connect();
    const queued = await Promise.all(Array.from({ length: 4 }, () => createJob(JobStatus.queued)));
    const [workerOne, workerTwo] = await Promise.all([
      new JobsRepository().claimQueuedJobs(2, queued.map((job) => job.id)),
      new JobsRepository().claimQueuedJobs(2, queued.map((job) => job.id)),
    ]);
    const claimedIds = [...workerOne, ...workerTwo].map((job) => job.id);
    expect(claimedIds).toHaveLength(4);
    expect(new Set(claimedIds).size).toBe(4);
    expect(claimedIds.sort()).toEqual(queued.map((job) => job.id).sort());

    const staleRetry = await createJob(
      JobStatus.processing,
      1,
      new Date(Date.now() - env.JOB_WORKER_STALE_AFTER_MS - 1000),
    );
    const staleFinal = await createJob(
      JobStatus.processing,
      env.JOB_WORKER_MAX_ATTEMPTS,
      new Date(Date.now() - env.JOB_WORKER_STALE_AFTER_MS - 1000),
    );
    await expect(new JobsRepository().recoverStaleJobs([staleRetry.id, staleFinal.id])).resolves.toBe(2);
    await expect(prisma.indexingJob.findUnique({ where: { id: staleRetry.id } })).resolves.toMatchObject({
      status: JobStatus.queued,
      resultJson: { code: 'JOB_WORKER_STALE', retryable: true },
    });
    await expect(prisma.indexingJob.findUnique({ where: { id: staleFinal.id } })).resolves.toMatchObject({
      status: JobStatus.failed,
      resultJson: { code: 'JOB_WORKER_STALE', retryable: false },
    });
    await expect(new JobsRepository().claimQueuedJobs(1, [staleRetry.id])).resolves.toEqual([]);
  });

  afterAll(async () => {
    if (fixtureIds.length) await prisma.indexingJob.deleteMany({ where: { id: { in: fixtureIds } } });
  });
});

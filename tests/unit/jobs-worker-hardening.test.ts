import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JobStatus, JobType } from '@prisma/client';

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn() }));
vi.mock('../../src/infrastructure/database/prisma', () => ({ prisma: {} }));

import { JobsRepository } from '../../src/modules/jobs/jobs.repository';
import { getJobFailureTransition, getJobRetryDelayMs, isJobFailureRetryable } from '../../src/modules/jobs/job-retry-policy';
import { startJobWorkerLoop } from '../../src/modules/jobs/worker-runner';

describe('worker retry policy', () => {
  it('requeues retryable failures below the attempt limit and permanently fails the last attempt', () => {
    expect(getJobFailureTransition({ retryable: true, attempts: 1, maxAttempts: 4 })).toEqual({
      status: JobStatus.queued,
      retryable: true,
    });
    expect(getJobFailureTransition({ retryable: true, attempts: 4, maxAttempts: 4 })).toEqual({
      status: JobStatus.failed,
      retryable: false,
    });
    expect(getJobFailureTransition({ retryable: false, attempts: 1, maxAttempts: 4 })).toEqual({
      status: JobStatus.failed,
      retryable: false,
    });
  });

  it('uses capped exponential retry backoff', () => {
    expect(getJobRetryDelayMs(1, 1000, 5000)).toBe(1000);
    expect(getJobRetryDelayMs(3, 1000, 5000)).toBe(4000);
    expect(getJobRetryDelayMs(8, 1000, 5000)).toBe(5000);
  });

  it('keeps legacy jobs manually retryable while honoring explicit permanent failures', () => {
    expect(isJobFailureRetryable(null)).toBe(true);
    expect(isJobFailureRetryable({ code: 'OPENAI_REFUSED', retryable: false })).toBe(false);
    expect(isJobFailureRetryable({ code: 'STORAGE_ERROR', retryable: true })).toBe(true);
  });
});

describe('JobsRepository atomic worker claims and recovery', () => {
  beforeEach(() => mocks.queryRaw.mockReset());

  it('claims a bounded batch in one PostgreSQL SKIP LOCKED statement', async () => {
    mocks.queryRaw.mockResolvedValue([
      { id: 'job-a', status: JobStatus.processing, jobType: JobType.evidence_ocr },
      { id: 'job-b', status: JobStatus.processing, jobType: JobType.event_roster_indexing },
    ]);
    const repository = new JobsRepository({ $queryRaw: mocks.queryRaw } as never);

    await expect(repository.claimQueuedJobs(3)).resolves.toHaveLength(2);
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
    const sql = String.raw({ raw: mocks.queryRaw.mock.calls[0][0].raw });
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain('RETURNING');
    expect(mocks.queryRaw.mock.calls[0].slice(1)).toContain(3);
  });

  it('recovers stale processing leases and returns only recovered job identifiers', async () => {
    mocks.queryRaw.mockResolvedValue([{ id: 'stale-job' }]);
    const repository = new JobsRepository({ $queryRaw: mocks.queryRaw } as never);

    await expect(repository.recoverStaleJobs()).resolves.toBe(1);
    const sql = String.raw({ raw: mocks.queryRaw.mock.calls[0][0].raw });
    expect(sql).toContain('status');
    expect(sql).toContain('processing');
    expect(sql).toContain('RETURNING');
  });
});

describe('worker shutdown', () => {
  it('waits for the active job and mail tick before stop resolves', async () => {
    let finishJob!: () => void;
    let finishMail!: () => void;
    const service = {
      runWorkerTick: vi.fn(() => new Promise((resolve) => {
        finishJob = () => resolve({ processed: 0, job: null, jobs: [] });
      })),
    };
    const mailService = {
      runTick: vi.fn(() => new Promise<void>((resolve) => { finishMail = resolve; })),
    };
    const runner = startJobWorkerLoop({ enabled: true, intervalMs: 1000, service: service as never, mailService: mailService as never });

    let stopped = false;
    const stopping = runner.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finishJob();
    await vi.waitFor(() => expect(mailService.runTick).toHaveBeenCalledOnce());
    finishMail();
    await stopping;
    expect(stopped).toBe(true);
  });
});

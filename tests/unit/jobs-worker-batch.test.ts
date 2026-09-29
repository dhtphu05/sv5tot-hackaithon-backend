import { JobStatus, JobType, type IndexingJob } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  evidenceFindUnique: vi.fn(),
  decisionFindUnique: vi.fn(),
  jobUpdate: vi.fn(),
  processEvidence: vi.fn(),
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({
  prisma: {
    evidence: { findUnique: mocks.evidenceFindUnique },
    decisionImport: { findUnique: mocks.decisionFindUnique },
    indexingJob: { update: mocks.jobUpdate },
  },
}));
vi.mock('../../src/modules/jobs/processors/evidence-ocr.processor', () => ({ processEvidenceOcrJob: mocks.processEvidence }));
vi.mock('../../src/modules/jobs/processors/event-roster-indexing.processor', () => ({ processEventRosterIndexingJob: vi.fn() }));
vi.mock('../../src/modules/jobs/processors/decision-metadata.processor', () => ({ processDecisionMetadataJob: vi.fn() }));
vi.mock('../../src/modules/jobs/processors/decision-roster-ocr.processor', () => ({ processDecisionRosterOcrJob: vi.fn() }));
vi.mock('../../src/modules/jobs/processors/award-roster-ingestion.processor', () => ({ processAwardRosterIngestionJob: vi.fn() }));

import { JobsService } from '../../src/modules/jobs/jobs.service';
import { env } from '../../src/config/env';
import { AppError } from '../../src/shared/errors/app-error';

function makeJob(id: string): IndexingJob {
  return {
    id,
    workspaceId: null,
    jobType: JobType.evidence_ocr,
    targetId: `evidence-${id}`,
    status: JobStatus.processing,
    attempts: 1,
    inputJson: null,
    errorMessage: null,
    resultJson: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('JobsService concurrent worker batches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.evidenceFindUnique.mockResolvedValue(null);
    mocks.decisionFindUnique.mockResolvedValue(null);
    mocks.jobUpdate.mockImplementation(({ where, data }) => ({ ...makeJob(where.id), ...data }));
  });

  it('processes the configured claimed batch concurrently and awaits every outcome', async () => {
    const jobs = [makeJob('a'), makeJob('b'), makeJob('c')];
    const repository = {
      recoverStaleJobs: vi.fn().mockResolvedValue(0),
      claimQueuedJobs: vi.fn().mockResolvedValue(jobs),
    };
    let active = 0;
    let maxActive = 0;
    const resolvers: Array<() => void> = [];
    mocks.processEvidence.mockImplementation(() => new Promise((resolve) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      resolvers.push(() => {
        active -= 1;
        resolve({ extracted: true });
      });
    }));
    const service = new JobsService(repository as never);

    const resultPromise = service.runWorkerTick();
    await vi.waitFor(() => expect(mocks.processEvidence).toHaveBeenCalledTimes(3));
    expect(maxActive).toBe(3);
    expect(repository.recoverStaleJobs).toHaveBeenCalledOnce();
    expect(repository.claimQueuedJobs).toHaveBeenCalledWith(env.JOB_WORKER_CONCURRENCY);
    resolvers.forEach((resolve) => resolve());

    await expect(resultPromise).resolves.toMatchObject({ processed: 3, jobs: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
  });

  it('requeues a retryable failure with safe extraction telemetry', async () => {
    const job = makeJob('retry');
    mocks.processEvidence.mockRejectedValueOnce(new AppError(502, 'OPENAI_PROVIDER_ERROR', 'OpenAI document extraction failed', {
      retryable: true,
      telemetry: { provider: 'openai', requestId: 'req-1', outcome: 'failure' },
    }));
    const repository = {
      recoverStaleJobs: vi.fn().mockResolvedValue(0),
      claimQueuedJobs: vi.fn().mockResolvedValue([job]),
    };

    await new JobsService(repository as never).runWorkerTick();

    expect(mocks.jobUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: job.id },
      data: expect.objectContaining({
        status: JobStatus.queued,
        resultJson: expect.objectContaining({ retryable: true, telemetry: { provider: 'openai', requestId: 'req-1', outcome: 'failure' } }),
      }),
    }));
  });

  it('does not retry permanent extraction failures', async () => {
    const job = makeJob('permanent');
    mocks.processEvidence.mockRejectedValueOnce(new AppError(422, 'OPENAI_REFUSED', 'OpenAI refused to extract this document', {
      retryable: false,
    }));
    const repository = {
      recoverStaleJobs: vi.fn().mockResolvedValue(0),
      claimQueuedJobs: vi.fn().mockResolvedValue([job]),
    };

    await new JobsService(repository as never).runWorkerTick();

    expect(mocks.jobUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: JobStatus.failed, resultJson: expect.objectContaining({ retryable: false }) }),
    }));
  });
});

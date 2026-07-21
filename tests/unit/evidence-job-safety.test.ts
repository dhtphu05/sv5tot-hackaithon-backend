import { JobStatus, JobType } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  buildEvidenceAnalysisJobInput,
  parseEvidenceAnalysisJobInput,
  isStaleEvidenceAnalysisJob,
} from '../../src/modules/jobs/evidence-analysis-job-input';
import { JobsRepository } from '../../src/modules/jobs/jobs.repository';

describe('evidence analysis job input', () => {
  it('binds a job to the exact evidence file and file', () => {
    const input = buildEvidenceAnalysisJobInput({
      evidenceId: 'evidence-1',
      evidenceFileId: 'evidence-file-1',
      fileId: 'file-1',
    });

    expect(parseEvidenceAnalysisJobInput(input)).toEqual({
      evidenceId: 'evidence-1',
      evidenceFileId: 'evidence-file-1',
      fileId: 'file-1',
    });
  });

  it('rejects missing or malformed job payloads', () => {
    expect(() => parseEvidenceAnalysisJobInput(null)).toThrow();
    expect(() => parseEvidenceAnalysisJobInput({ evidenceId: 'evidence-1' })).toThrow();
  });

  it('detects stale evidence jobs before card persistence', () => {
    expect(
      isStaleEvidenceAnalysisJob(
        { evidenceFileId: 'old-evidence-file', fileId: 'old-file' },
        { evidenceFileId: 'new-evidence-file', fileId: 'new-file' },
      ),
    ).toBe(true);

    expect(
      isStaleEvidenceAnalysisJob(
        { evidenceFileId: 'current-evidence-file', fileId: 'current-file' },
        { evidenceFileId: 'current-evidence-file', fileId: 'current-file' },
      ),
    ).toBe(false);
  });
});

describe('JobsRepository queued job claiming', () => {
  it('uses compare-and-set status updates so a queued job can be claimed once', async () => {
    const job: {
      id: string;
      workspaceId: string;
      jobType: JobType;
      targetId: string;
      status: JobStatus;
      attempts: number;
      inputJson: null;
      errorMessage: null;
      resultJson: null;
      createdAt: Date;
      updatedAt: Date;
    } = {
      id: 'job-1',
      workspaceId: 'workspace-1',
      jobType: JobType.evidence_ocr,
      targetId: 'evidence-1',
      status: JobStatus.queued,
      attempts: 0,
      inputJson: null,
      errorMessage: null,
      resultJson: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const db = {
      indexingJob: {
        findFirst: async ({ where }: { where: { status: JobStatus } }) =>
          job.status === where.status ? job : null,
        updateMany: async ({ where }: { where: { id: string; status: JobStatus } }) => {
          if (where.id === job.id && job.status === where.status) {
            job.status = JobStatus.processing;
            job.attempts += 1;
            return { count: 1 };
          }
          return { count: 0 };
        },
        findUnique: async ({ where }: { where: { id: string } }) =>
          where.id === job.id ? job : null,
      },
    };
    const repository = new JobsRepository(db as never);

    await expect(repository.claimNextQueuedJob()).resolves.toMatchObject({
      id: 'job-1',
      status: JobStatus.processing,
      attempts: 1,
    });
    await expect(repository.claimNextQueuedJob()).resolves.toBeNull();
  });
});

import { JobStatus, JobType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  buildEvidenceAnalysisJobInput,
  parseEvidenceAnalysisJobInput,
  isStaleEvidenceAnalysisJob,
  recoverEvidenceAnalysisJobInputFromCurrentFile,
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

  it('normalizes persisted JSON objects and ignores unrelated metadata', () => {
    const input = Object.assign(Object.create(null), {
      evidenceId: 'evidence-1',
      evidenceFileId: 'evidence-file-1',
      fileId: 'file-1',
      requestId: 'internal-metadata',
    });

    expect(parseEvidenceAnalysisJobInput(input)).toEqual({
      evidenceId: 'evidence-1',
      evidenceFileId: 'evidence-file-1',
      fileId: 'file-1',
    });
  });

  it('accepts snake_case binding keys from legacy job payloads', () => {
    expect(
      parseEvidenceAnalysisJobInput({
        evidence_id: 'evidence-1',
        evidence_file_id: 'evidence-file-1',
        file_id: 'file-1',
      }),
    ).toEqual({
      evidenceId: 'evidence-1',
      evidenceFileId: 'evidence-file-1',
      fileId: 'file-1',
    });
  });

  it('recovers missing binding only when one current evidence file exists', () => {
    expect(
      recoverEvidenceAnalysisJobInputFromCurrentFile('evidence-1', [
        { id: 'evidence-file-1', fileId: 'file-1' },
      ]),
    ).toEqual({
      evidenceId: 'evidence-1',
      evidenceFileId: 'evidence-file-1',
      fileId: 'file-1',
      provider: 'openai',
      trigger: 'manual_retry',
    });

    expect(
      recoverEvidenceAnalysisJobInputFromCurrentFile('evidence-1', [
        { id: 'old-evidence-file', fileId: 'old-file' },
        { id: 'new-evidence-file', fileId: 'new-file' },
      ]),
    ).toBeNull();
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
  it('uses one atomic SKIP LOCKED statement to claim a bounded batch once', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      { id: 'job-1', status: JobStatus.processing, jobType: JobType.evidence_ocr },
    ]);
    const db = {
      $queryRaw: queryRaw,
    };
    const repository = new JobsRepository(db as never);

    await expect(repository.claimQueuedJobs(2)).resolves.toMatchObject([
      { id: 'job-1', status: JobStatus.processing, jobType: JobType.evidence_ocr },
    ]);
    expect(queryRaw).toHaveBeenCalledOnce();
    expect(queryRaw.mock.calls[0][0].join('')).toContain('FOR UPDATE SKIP LOCKED');
    expect(queryRaw.mock.calls[0]).toContain(2);
  });
});

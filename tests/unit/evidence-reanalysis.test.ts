import { EvidenceSourceType, IndexingStatus, JobStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { shouldReanalyseLegacyEvidence } from '../../src/modules/evidences/evidence-reanalysis';

const activeFile = {
  evidenceFileId: 'evidence-file-current',
  fileId: 'file-current',
  createdAt: new Date('2026-07-21T00:00:00.000Z'),
};

describe('legacy evidence reanalysis detector', () => {
  it('requires OpenAI reanalysis for stale legacy SmartReader cards', () => {
    const decision = shouldReanalyseLegacyEvidence({
      providerConfigured: true,
      activeFile,
      evidence: {
        sourceType: EvidenceSourceType.manual_upload,
        indexingStatus: IndexingStatus.indexed,
      },
      evidenceCard: {
        provider: 'smartreader',
        providerModel: 'vnpt_smartreader',
        sourceEndpoint: 'ocrAdvanced:scan-table',
        confidence: 0.5,
        normalizedFieldsJson: { event_name: 'Mùa hè xanh' },
        sourceEvidenceFileId: 'old-evidence-file',
        sourceFileId: 'old-file',
        analysedAt: new Date('2026-06-01T00:00:00.000Z'),
      },
    });

    expect(decision.required).toBe(true);
    expect(decision.safeToAutoQueue).toBe(true);
    expect(decision.reasons).toEqual(
      expect.arrayContaining([
        'legacy_smartreader_provider',
        'active_file_changed',
        'low_confidence',
        'missing_identity',
        'missing_date',
      ]),
    );
  });

  it('does not reanalyse trusted event imports or active jobs', () => {
    expect(
      shouldReanalyseLegacyEvidence({
        providerConfigured: true,
        activeFile,
        evidence: {
          sourceType: EvidenceSourceType.event_import,
          indexingStatus: IndexingStatus.indexed,
        },
        evidenceCard: null,
      }).skipReason,
    ).toBe('event_import');

    expect(
      shouldReanalyseLegacyEvidence({
        providerConfigured: true,
        activeFile,
        evidence: {
          sourceType: EvidenceSourceType.manual_upload,
          indexingStatus: IndexingStatus.indexed,
        },
        activeJobs: [{ status: JobStatus.queued, inputJson: activeFile }],
        evidenceCard: { provider: 'smartreader', extractedFieldsJson: {} },
      }).skipReason,
    ).toBe('analysis_job_already_active');
  });

  it('does not loop on a fresh OpenAI card for the current file', () => {
    const decision = shouldReanalyseLegacyEvidence({
      providerConfigured: true,
      activeFile,
      now: new Date('2026-07-22T00:00:00.000Z'),
      evidence: {
        sourceType: EvidenceSourceType.manual_upload,
        indexingStatus: IndexingStatus.indexed,
      },
      evidenceCard: {
        provider: 'openai',
        providerModel: 'gpt-test',
        promptVersion: 'evidence-card-v1',
        sourceEvidenceFileId: activeFile.evidenceFileId,
        sourceFileId: activeFile.fileId,
        confidence: 0.4,
        normalizedFieldsJson: { event_name: 'Thi học thuật' },
        analysedAt: new Date('2026-07-21T01:00:00.000Z'),
      },
    });

    expect(decision.required).toBe(false);
    expect(decision.skipReason).toBe('fresh_openai_current_file');
  });
});

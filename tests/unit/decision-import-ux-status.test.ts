import { DecisionImportStatus, JobStatus, SmartReaderJobStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { mapDecisionImportUxStatus } from '../../src/modules/decision-imports/decision-import-ux-status.mapper';

describe('DecisionImport UX status', () => {
  it('describes current extraction without naming a retired provider', () => {
    const status = mapDecisionImportUxStatus({
      status: DecisionImportStatus.ocr_processing,
      metadataJobStatus: JobStatus.processing,
      smartReaderStatus: SmartReaderJobStatus.completed,
    });

    expect(status).toMatchObject({ state: 'processing', label: 'Đang xử lý tài liệu' });
    expect(status.label).not.toContain('VNPT');
  });

  it('reports queued jobs even when historical SmartReader records exist', () => {
    expect(mapDecisionImportUxStatus({
      status: DecisionImportStatus.extracting_metadata,
      metadataJobStatus: JobStatus.queued,
      smartReaderStatus: SmartReaderJobStatus.completed,
    }).state).toBe('queued');
  });
});

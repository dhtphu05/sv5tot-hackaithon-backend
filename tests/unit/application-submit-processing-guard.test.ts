import { EvidenceStatus, IndexingStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { hasActiveEvidenceProcessing } from '../../src/modules/applications/applications.service';

describe('application submit evidence processing guard', () => {
  it.each([
    IndexingStatus.pending_indexing,
    IndexingStatus.ocr_processing,
    IndexingStatus.extracting,
    IndexingStatus.checking_registry,
  ])('blocks submission while evidence indexing status is %s', (indexingStatus) => {
    expect(
      hasActiveEvidenceProcessing({
        evidences: [
          {
            status: EvidenceStatus.indexed,
            indexingStatus,
          },
        ],
      }),
    ).toBe(true);
  });

  it('does not block forever for failed or manual-review evidence', () => {
    expect(
      hasActiveEvidenceProcessing({
        evidences: [
          { status: EvidenceStatus.indexed, indexingStatus: IndexingStatus.failed },
          { status: EvidenceStatus.needs_supplement, indexingStatus: IndexingStatus.needs_manual_review },
        ],
      }),
    ).toBe(false);
  });
});

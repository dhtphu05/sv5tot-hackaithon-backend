import { Criterion } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { VnptSmartReaderClient } from '../../src/infrastructure/vnpt/vnpt-smartreader.client';
import { generateEvidenceCard } from '../../src/modules/ai/evidence-card.generator';

describe('mock evidence card generation', () => {
  it('generates a high-confidence volunteer card from matching filename', async () => {
    const client = new VnptSmartReaderClient();
    const ocr = await client.extractEvidence({
      originalName: 'giay-chung-nhan-mua-he-xanh.pdf',
      mimeType: 'application/pdf',
    });

    const card = generateEvidenceCard({
      evidence: {
        evidenceName: 'Giấy chứng nhận Mùa hè xanh 2025',
        criterion: Criterion.volunteer,
      },
      smartReaderResult: ocr,
    });

    expect(card.confidence).toBeGreaterThanOrEqual(0.75);
    expect(card.warningsJson.some((warning) => warning.code === 'CRITERION_MISMATCH')).toBe(false);
    expect(card.aiSummary).toContain('gợi ý');
  });

  it('warns when OCR criterion differs from selected criterion', async () => {
    const client = new VnptSmartReaderClient();
    const ocr = await client.extractEvidence({
      originalName: 'mua-he-xanh.pdf',
      mimeType: 'application/pdf',
    });

    const card = generateEvidenceCard({
      evidence: {
        evidenceName: 'Minh chứng học tập',
        criterion: Criterion.academic,
      },
      smartReaderResult: ocr,
    });

    expect(card.warningsJson.map((warning) => warning.code)).toContain('CRITERION_MISMATCH');
  });

  it('warns for blurred files', async () => {
    const client = new VnptSmartReaderClient();
    const ocr = await client.extractEvidence({
      originalName: 'blur-mua-he-xanh.pdf',
      mimeType: 'application/pdf',
    });

    const card = generateEvidenceCard({
      evidence: {
        evidenceName: 'Giấy chứng nhận tình nguyện',
        criterion: Criterion.volunteer,
      },
      smartReaderResult: ocr,
    });

    expect(card.warningsJson.map((warning) => warning.code)).toContain('BLURRY_FILE');
  });
});

// Owns confidence scoring for generated evidence cards.
import type { Criterion } from '@prisma/client';
import type { SmartReaderEvidenceResult } from '../../infrastructure/vnpt/vnpt-smartreader.client';

export function scoreEvidenceConfidence(input: {
  evidenceCriterion: Criterion;
  smartReaderResult: SmartReaderEvidenceResult;
}): number {
  const { evidenceCriterion, smartReaderResult } = input;
  const fields = smartReaderResult.extractedFields;
  let score = 0.5;

  if (smartReaderResult.quality.readability >= 0.8) score += 0.15;
  if (fields.studentName || fields.studentCode) score += 0.1;
  if (fields.issuedDate) score += 0.1;
  if (fields.organizer) score += 0.1;
  if (fields.criterionHint === evidenceCriterion) score += 0.1;
  if (smartReaderResult.quality.hasSignatureOrStamp) score += 0.05;
  if (smartReaderResult.quality.isBlurred) score -= 0.2;
  if (fields.criterionHint && fields.criterionHint !== evidenceCriterion) score -= 0.15;

  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

// Owns evidence-card generation from OCR and knowledge-base signals.
import type { Criterion, Evidence } from '@prisma/client';
import type { SmartReaderEvidenceResult } from '../../infrastructure/vnpt/vnpt-smartreader.client';
import { scoreEvidenceConfidence } from './confidence.scorer';

export type EvidenceCardWarning = {
  code:
    | 'BLURRY_FILE'
    | 'MISSING_ISSUED_DATE'
    | 'MISSING_ORGANIZER'
    | 'MISSING_STUDENT_INFO'
    | 'CRITERION_MISMATCH'
    | 'LOW_CONFIDENCE'
    | 'NEEDS_MANUAL_REVIEW';
  message: string;
};

export type GeneratedEvidenceCard = {
  ocrText: string;
  extractedFieldsJson: Record<string, unknown>;
  warningsJson: EvidenceCardWarning[];
  matchedKnowledgeItemIds: string[];
  confidence: number;
  aiSummary: string;
  rawAiResponse: Record<string, unknown>;
};

export function generateEvidenceCard(input: {
  evidence: Pick<Evidence, 'criterion' | 'evidenceName'>;
  smartReaderResult: SmartReaderEvidenceResult;
  matchedKnowledgeItemIds?: string[];
}): GeneratedEvidenceCard {
  const confidence = scoreEvidenceConfidence({
    evidenceCriterion: input.evidence.criterion,
    smartReaderResult: input.smartReaderResult,
  });
  const warnings = buildWarnings(input.evidence.criterion, input.smartReaderResult, confidence);

  return {
    ocrText: input.smartReaderResult.ocrText,
    extractedFieldsJson: input.smartReaderResult.extractedFields,
    warningsJson: warnings,
    matchedKnowledgeItemIds: input.matchedKnowledgeItemIds ?? [],
    confidence,
    aiSummary: buildSummary(input.evidence.evidenceName, input.smartReaderResult, warnings),
    rawAiResponse: input.smartReaderResult.raw,
  };
}

function buildWarnings(
  criterion: Criterion,
  result: SmartReaderEvidenceResult,
  confidence: number,
): EvidenceCardWarning[] {
  const warnings: EvidenceCardWarning[] = [];
  const fields = result.extractedFields;

  if (result.quality.isBlurred) {
    warnings.push({ code: 'BLURRY_FILE', message: 'Tệp có dấu hiệu mờ hoặc khó đọc.' });
  }
  if (!fields.issuedDate) {
    warnings.push({ code: 'MISSING_ISSUED_DATE', message: 'Thiếu ngày cấp hoặc ngày tham gia.' });
  }
  if (!fields.organizer) {
    warnings.push({ code: 'MISSING_ORGANIZER', message: 'Thiếu đơn vị tổ chức hoặc xác nhận.' });
  }
  if (!fields.studentName && !fields.studentCode) {
    warnings.push({ code: 'MISSING_STUDENT_INFO', message: 'Thiếu họ tên hoặc mã số sinh viên.' });
  }
  if (fields.criterionHint && fields.criterionHint !== criterion) {
    warnings.push({
      code: 'CRITERION_MISMATCH',
      message: 'Nhóm tiêu chí người dùng chọn khác gợi ý từ OCR.',
    });
  }
  if (confidence < 0.6) {
    warnings.push({ code: 'LOW_CONFIDENCE', message: 'Độ tin cậy thấp, cần kiểm tra thủ công.' });
  }
  if (warnings.length > 0 || confidence < 0.75) {
    warnings.push({ code: 'NEEDS_MANUAL_REVIEW', message: 'Cần cán bộ kiểm tra lại minh chứng.' });
  }

  return warnings;
}

function buildSummary(
  evidenceName: string,
  result: SmartReaderEvidenceResult,
  warnings: EvidenceCardWarning[],
): string {
  const activityName = result.extractedFields.activityName ?? evidenceName;
  const base = `Hệ thống đọc được minh chứng "${activityName}" và gợi ý dữ liệu liên quan.`;

  if (warnings.length === 0) {
    return `${base} Có khả năng thông tin chính đã đủ, nhưng vẫn cần cán bộ kiểm tra trước khi xác nhận.`;
  }

  return `${base} Cần kiểm tra hoặc bổ sung: ${warnings
    .map((warning) => warning.message)
    .join(' ')}`;
}

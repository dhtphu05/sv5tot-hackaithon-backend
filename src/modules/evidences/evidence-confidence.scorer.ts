import type { EvidenceExtractedFields } from './evidence-field-extractor';

export type EvidenceConfidenceInput = {
  ocrSucceeded: boolean;
  fields: EvidenceExtractedFields;
  evidenceName: string;
  matchedEventId?: string | null;
  warnings?: string[];
};

export type EvidenceConfidenceResult = {
  confidence: number;
  needsManualReview: boolean;
  warningCodes: string[];
};

export function scoreEvidenceConfidence(input: EvidenceConfidenceInput): EvidenceConfidenceResult {
  if (!input.ocrSucceeded) {
    return { confidence: 0, needsManualReview: true, warningCodes: ['OCR_FAILED'] };
  }

  const warnings = new Set<string>();
  if (input.fields.document_type === 'transcript') {
    let score = 0.45;
    if (input.fields.student_name || input.fields.student_code) score += 0.2;
    if (input.fields.class_name || input.fields.faculty) score += 0.1;
    if (typeof input.fields.gpa === 'number') score += 0.2;
    if (typeof input.fields.conduct_score === 'number') score += 0.05;

    if (!input.fields.student_name && !input.fields.student_code)
      warnings.add('MISSING_STUDENT_INFO');
    if (typeof input.fields.gpa !== 'number') warnings.add('MISSING_GPA');
    if (input.warnings?.some((warning) => /blur|mờ|nghiêng|góc|corner/i.test(warning))) {
      score -= 0.1;
      warnings.add('LOW_IMAGE_QUALITY');
    }

    const confidence = Math.max(0, Math.min(1, Number(score.toFixed(2))));
    if (confidence < 0.6) warnings.add('LOW_CONFIDENCE');
    return {
      confidence,
      needsManualReview: confidence < 0.6,
      warningCodes: Array.from(warnings),
    };
  }

  let score = 0.35;

  if (input.fields.student_name || input.fields.student_code) score += 0.15;
  if (hasClearEventName(input.fields.event_name, input.evidenceName)) score += 0.1;
  if (input.fields.issue_date || input.fields.activity_date) score += 0.1;
  if (input.fields.organizer) score += 0.1;
  if (input.matchedEventId) score += 0.2;

  if (!input.fields.student_name && !input.fields.student_code) {
    score -= 0.1;
    warnings.add('MISSING_STUDENT_INFO');
  }
  if (!hasClearEventName(input.fields.event_name, input.evidenceName)) {
    score -= 0.1;
    warnings.add('MISSING_EVENT_NAME');
  }
  if (!input.fields.issue_date && !input.fields.activity_date) {
    score -= 0.1;
    warnings.add('MISSING_DATE');
  }
  if (!input.fields.organizer) {
    score -= 0.1;
    warnings.add('MISSING_ORGANIZER');
  }
  if (input.warnings?.some((warning) => /blur|mờ|nghiêng|góc|corner/i.test(warning))) {
    score -= 0.1;
    warnings.add('LOW_IMAGE_QUALITY');
  }
  if (input.warnings?.some((warning) => /wrong_student|sai sinh viên/i.test(warning))) {
    score -= 0.3;
    warnings.add('POSSIBLE_STUDENT_MISMATCH');
  }

  const confidence = Math.max(0, Math.min(1, Number(score.toFixed(2))));
  if (confidence < 0.6) warnings.add('LOW_CONFIDENCE');

  return {
    confidence,
    needsManualReview: confidence < 0.6,
    warningCodes: Array.from(warnings),
  };
}

function hasClearEventName(eventName: string | undefined, evidenceName: string): boolean {
  const value = eventName ?? evidenceName;
  return value.trim().length >= 6;
}

import { EvidenceSourceType, IndexingStatus } from '@prisma/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';

export const evidenceCardConfirmationStatuses = {
  pending: 'pending',
  correctionRequired: 'correction_required',
  confirmed: 'confirmed',
  notRequired: 'not_required',
} as const;

export type EvidenceCardConfirmationStatus =
  (typeof evidenceCardConfirmationStatuses)[keyof typeof evidenceCardConfirmationStatuses];

export const editableEvidenceCardFields = [
  'student_name',
  'student_code',
  'class_name',
  'faculty',
  'event_name',
  'organizer',
  'organizer_level',
  'issue_date',
  'activity_date',
  'award_level',
  'volunteer_days',
  'certificate_type',
  'language_score',
  'gpa',
  'conduct_score',
] as const;

export type EditableEvidenceCardField = (typeof editableEvidenceCardFields)[number];

const editableFieldSet = new Set<string>(editableEvidenceCardFields);
const organizerLevels = new Set([
  'class',
  'faculty',
  'school',
  'university',
  'city',
  'central',
  'club',
  'external',
  'unknown',
]);
const dateFields = new Set(['issue_date', 'activity_date']);
const numericFields = new Set(['volunteer_days', 'language_score', 'gpa', 'conduct_score']);
const textFields = new Set(
  editableEvidenceCardFields.filter(
    (field) => !dateFields.has(field) && !numericFields.has(field) && field !== 'organizer_level',
  ),
);

export type EvidenceCardLike = {
  provider?: string | null;
  extractedFieldsJson?: unknown;
  normalizedFieldsJson?: unknown;
  confirmedFieldsJson?: unknown;
  fieldConfidenceJson?: unknown;
  warningsJson?: unknown;
  confirmationStatus?: string | null;
  requiresHumanConfirmation?: boolean | null;
};

export type EvidenceLikeForTrust = {
  id: string;
  sourceType: EvidenceSourceType | string;
  indexingStatus: IndexingStatus | string;
  evidenceCard?: EvidenceCardLike | null;
};

export type EffectiveEvidenceCardField = {
  key: EditableEvidenceCardField;
  label: string;
  extractedValue: string | number | null;
  correctedValue: string | number | null;
  effectiveValue: string | number | null;
  confidence: number | null;
  source:
    | 'openai'
    | 'smartreader'
    | 'mock'
    | 'event_registry'
    | 'student_corrected'
    | 'student_confirmed';
  editable: boolean;
  requiredForConfirmation: boolean;
  warningCodes: string[];
};

export function normalizeConfirmationStatus(value?: string | null): EvidenceCardConfirmationStatus {
  if (
    value === evidenceCardConfirmationStatuses.pending ||
    value === evidenceCardConfirmationStatuses.correctionRequired ||
    value === evidenceCardConfirmationStatuses.confirmed ||
    value === evidenceCardConfirmationStatuses.notRequired
  ) {
    return value;
  }
  return evidenceCardConfirmationStatuses.pending;
}

export function isEvidenceProcessing(indexingStatus: IndexingStatus | string): boolean {
  return (
    indexingStatus === IndexingStatus.pending_indexing ||
    indexingStatus === IndexingStatus.ocr_processing ||
    indexingStatus === IndexingStatus.extracting ||
    indexingStatus === IndexingStatus.checking_registry
  );
}

export function canUseEvidenceCardForPrecheck(evidence: EvidenceLikeForTrust): boolean {
  const card = evidence.evidenceCard;
  if (!card || isEvidenceProcessing(evidence.indexingStatus)) return false;
  if (evidence.sourceType === EvidenceSourceType.event_import) return true;
  return normalizeConfirmationStatus(card.confirmationStatus) === evidenceCardConfirmationStatuses.confirmed;
}

export function needsEvidenceConfirmation(evidence: EvidenceLikeForTrust): boolean {
  const card = evidence.evidenceCard;
  if (!card || evidence.sourceType === EvidenceSourceType.event_import) return false;
  if (isEvidenceProcessing(evidence.indexingStatus) || evidence.indexingStatus === IndexingStatus.failed) {
    return false;
  }
  const status = normalizeConfirmationStatus(card.confirmationStatus);
  return (
    card.requiresHumanConfirmation === true ||
    status === evidenceCardConfirmationStatuses.pending ||
    status === evidenceCardConfirmationStatuses.correctionRequired
  );
}

export function getTrustedEvidenceCardFields(evidence: EvidenceLikeForTrust): Record<string, unknown> {
  if (!canUseEvidenceCardForPrecheck(evidence)) return {};
  const card = evidence.evidenceCard;
  if (!card) return {};
  if (evidence.sourceType === EvidenceSourceType.event_import) {
    return asRecord(card.confirmedFieldsJson) ?? asRecord(card.normalizedFieldsJson) ?? asRecord(card.extractedFieldsJson) ?? {};
  }
  return asRecord(card.confirmedFieldsJson) ?? {};
}

export function buildEffectiveEvidenceCardFields(input: {
  sourceType: EvidenceSourceType | string;
  provider?: string | null;
  extractedFields: unknown;
  normalizedFields: unknown;
  confirmedFields: unknown;
  fieldConfidence: unknown;
  warnings: unknown;
  confirmationStatus?: string | null;
}): {
  extractedFields: Record<string, unknown>;
  confirmedFields: Record<string, unknown>;
  effectiveFields: Record<string, unknown>;
  fieldDetails: EffectiveEvidenceCardField[];
} {
  const extracted = asRecord(input.normalizedFields) ?? asRecord(input.extractedFields) ?? {};
  const confirmed = asRecord(input.confirmedFields) ?? {};
  const confidence = asNumberRecord(input.fieldConfidence);
  const warningMap = warningsByField(input.warnings);
  const status = normalizeConfirmationStatus(input.confirmationStatus);
  const effective =
    status === evidenceCardConfirmationStatuses.confirmed ||
    status === evidenceCardConfirmationStatuses.notRequired
      ? { ...extracted, ...confirmed }
      : { ...extracted, ...confirmed };

  const details = editableEvidenceCardFields.reduce<EffectiveEvidenceCardField[]>((acc, key) => {
      const extractedValue = normalizeDisplayValue(extracted[key]);
      const correctedPresent = Object.prototype.hasOwnProperty.call(confirmed, key);
      const correctedValue = correctedPresent ? normalizeDisplayValue(confirmed[key]) : null;
      const effectiveValue = correctedPresent ? correctedValue : extractedValue;
      if (extractedValue === null && correctedValue === null && effectiveValue === null) return acc;
      acc.push({
        key,
        label: fieldLabels[key],
        extractedValue,
        correctedValue,
        effectiveValue,
        confidence: confidence[key] ?? null,
        source: resolveFieldSource({
          sourceType: input.sourceType,
          provider: input.provider,
          correctedPresent,
          confirmed: status === evidenceCardConfirmationStatuses.confirmed,
        }),
        editable: input.sourceType !== EvidenceSourceType.event_import,
        requiredForConfirmation: input.sourceType !== EvidenceSourceType.event_import,
        warningCodes: warningMap[key] ?? [],
      });
      return acc;
    }, []);

  return {
    extractedFields: extracted,
    confirmedFields: confirmed,
    effectiveFields: effective,
    fieldDetails: details,
  };
}

export function validateEvidenceCardCorrections(input: unknown): Record<EditableEvidenceCardField, string | number | null> {
  const fields = asRecord(input);
  if (!fields) {
    throw new AppError(400, ErrorCodes.EVIDENCE_CARD_VALIDATION_FAILED, 'fields must be an object');
  }

  const result: Partial<Record<EditableEvidenceCardField, string | number | null>> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!editableFieldSet.has(key)) {
      throw new AppError(400, ErrorCodes.EVIDENCE_CARD_FIELD_NOT_EDITABLE, `${key} is not editable`);
    }
    result[key as EditableEvidenceCardField] = validateFieldValue(key as EditableEvidenceCardField, value);
  }
  return result as Record<EditableEvidenceCardField, string | number | null>;
}

export function mergeFieldCorrections(
  current: unknown,
  updates: Record<string, string | number | null>,
): Record<string, unknown> {
  return {
    ...(asRecord(current) ?? {}),
    ...updates,
  };
}

function validateFieldValue(field: EditableEvidenceCardField, value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;

  if (field === 'organizer_level') {
    const normalized = String(value).trim();
    if (!organizerLevels.has(normalized)) {
      throw new AppError(400, ErrorCodes.EVIDENCE_CARD_VALIDATION_FAILED, 'Invalid organizer level');
    }
    return normalized;
  }

  if (dateFields.has(field)) {
    const normalized = String(value).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(new Date(`${normalized}T00:00:00.000Z`).getTime())) {
      throw new AppError(400, ErrorCodes.EVIDENCE_CARD_VALIDATION_FAILED, 'Invalid date value');
    }
    return normalized;
  }

  if (numericFields.has(field)) {
    const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
    if (!Number.isFinite(parsed)) {
      throw new AppError(400, ErrorCodes.EVIDENCE_CARD_VALIDATION_FAILED, 'Invalid numeric value');
    }
    if (field === 'volunteer_days' && parsed < 0) throwInvalidField();
    if (field === 'language_score' && parsed < 0) throwInvalidField();
    if (field === 'gpa' && (parsed < 0 || parsed > 4)) throwInvalidField();
    if (field === 'conduct_score' && (parsed < 0 || parsed > 100)) throwInvalidField();
    return parsed;
  }

  if (textFields.has(field)) {
    const normalized = String(value).trim();
    if (field === 'student_code' && !/^[A-Za-z0-9._-]{4,32}$/.test(normalized)) {
      throw new AppError(400, ErrorCodes.EVIDENCE_CARD_VALIDATION_FAILED, 'Invalid student code');
    }
    return normalized;
  }

  return null;
}

function resolveFieldSource(input: {
  sourceType: EvidenceSourceType | string;
  provider?: string | null;
  correctedPresent: boolean;
  confirmed: boolean;
}): EffectiveEvidenceCardField['source'] {
  if (input.sourceType === EvidenceSourceType.event_import) return 'event_registry';
  if (input.correctedPresent) return 'student_corrected';
  if (input.confirmed) return 'student_confirmed';
  if (input.provider === 'openai' || input.provider === 'mock' || input.provider === 'smartreader') {
    return input.provider;
  }
  return 'mock';
}

function normalizeDisplayValue(value: unknown): string | number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') return value.trim() || null;
  return null;
}

function warningsByField(value: unknown): Record<string, string[]> {
  if (!Array.isArray(value)) return {};
  return value.reduce<Record<string, string[]>>((acc, item) => {
    const record = asRecord(item);
    const field = typeof record?.field === 'string' ? record.field : null;
    const code = typeof record?.code === 'string' ? record.code : null;
    if (!field || !code) return acc;
    acc[field] = [...(acc[field] ?? []), code];
    return acc;
  }, {});
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumberRecord(value: unknown): Record<string, number> {
  const record = asRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, number] => typeof entry[1] === 'number'),
  );
}

function throwInvalidField(): never {
  throw new AppError(400, ErrorCodes.EVIDENCE_CARD_VALIDATION_FAILED, 'Invalid field value');
}

const fieldLabels: Record<EditableEvidenceCardField, string> = {
  student_name: 'Họ tên',
  student_code: 'MSSV',
  class_name: 'Lớp',
  faculty: 'Khoa',
  event_name: 'Tên hoạt động',
  organizer: 'Đơn vị tổ chức',
  organizer_level: 'Cấp tổ chức',
  issue_date: 'Ngày cấp',
  activity_date: 'Ngày hoạt động',
  award_level: 'Cấp giải thưởng',
  volunteer_days: 'Số ngày tình nguyện',
  certificate_type: 'Loại chứng chỉ',
  language_score: 'Điểm ngoại ngữ',
  gpa: 'GPA',
  conduct_score: 'Điểm rèn luyện',
};

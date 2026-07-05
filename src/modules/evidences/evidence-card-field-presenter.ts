import type { Criterion, EvidenceSourceType } from '@prisma/client';

type JsonRecord = Record<string, unknown>;

export type PresentedFieldValue =
  | string
  | number
  | boolean
  | {
      raw: string;
      display: string;
      hasTime?: boolean;
      label?: string;
    };

export type EvidenceCardFieldLayers = {
  userProvidedFields: JsonRecord;
  studentProfileFields: JsonRecord;
  extractedFields: JsonRecord;
  normalizedFields: JsonRecord;
  verifiedFields: JsonRecord;
  primaryFields: JsonRecord;
  fieldConfidence: Record<string, number>;
  metricSuggestions: JsonRecord;
  academic?: JsonRecord;
};

const organizerLevelLabels: Record<string, string> = {
  school: 'Cấp Trường',
  university: 'Cấp Đại học',
  city: 'Cấp Thành phố',
  central: 'Cấp Trung ương',
  faculty: 'Cấp Khoa',
  club: 'CLB/Đội/Nhóm',
  external: 'Đơn vị ngoài trường',
  unknown: 'Chưa xác định',
};

const dateFieldKeys = new Set([
  'issueDate',
  'issue_date',
  'activityDate',
  'activity_date',
  'startDate',
  'start_date',
  'endDate',
  'end_date',
]);

export function buildEvidenceCardFieldLayers(input: {
  evidenceName: string;
  sourceType: EvidenceSourceType | string;
  criterion: Criterion | string;
  extractedFields: unknown;
  normalizedFields: unknown;
  matchedEventId?: string | null;
  matchedParticipantId?: string | null;
  warnings?: unknown;
  studentProfileFields?: unknown;
  applicationMetrics?: Array<{
    metricType: string;
    value: number | string | null;
    scale?: number | null;
  }>;
  targetLevel?: string | null;
}): EvidenceCardFieldLayers {
  const extracted = presentFields(input.extractedFields);
  const normalized = presentFields(input.normalizedFields);
  const normalizedRaw = isRecord(input.normalizedFields) ? input.normalizedFields : {};
  const studentProfileFields = presentFields(input.studentProfileFields);
  const warningCodes = warningCodeSet(input.warnings);
  const verifiedFields: JsonRecord =
    input.sourceType === 'event_import' || (input.matchedEventId && input.matchedParticipantId)
      ? removeEmpty({
          matchSource: 'event_registry',
          matchedEventId: input.matchedEventId,
          matchedParticipantId: input.matchedParticipantId,
          eventName: normalized.event_name ?? normalized.eventName,
        })
      : {};
  const metricSuggestions = buildMetricSuggestions(normalizedRaw);
  const academic = buildAcademicLayer({
    criterion: input.criterion,
    applicationMetrics: input.applicationMetrics ?? [],
    targetLevel: input.targetLevel,
    metricSuggestions,
  });

  return {
    userProvidedFields: removeEmpty({
      evidenceName: input.evidenceName,
      sourceType: input.sourceType,
      criterion: input.criterion,
    }),
    studentProfileFields,
    extractedFields: extracted,
    normalizedFields: normalized,
    verifiedFields,
    primaryFields: removeEmpty({
      evidenceName: input.evidenceName,
      studentName: studentProfileFields.studentName,
      studentCode: studentProfileFields.studentCode,
      className: studentProfileFields.className,
      faculty: studentProfileFields.faculty,
      eventName: verifiedFields.eventName ?? input.evidenceName,
      organizer: verifiedFields.organizer ?? normalized.organizer,
      organizerLevel: verifiedFields.organizerLevel ?? normalized.organizer_level,
      issueDate: normalized.issue_date ?? normalized.issueDate,
      activityDate: normalized.activity_date ?? normalized.activityDate,
    }),
    fieldConfidence: buildFieldConfidence({
      evidenceName: input.evidenceName,
      normalizedFields: normalizedRaw,
      studentProfileFields,
      warningCodes,
      matchedEventId: input.matchedEventId,
      matchedParticipantId: input.matchedParticipantId,
    }),
    metricSuggestions,
    ...(academic ? { academic } : {}),
  };
}

export function presentFields(fields: unknown): JsonRecord {
  if (!isRecord(fields)) return {};
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => [key, presentFieldValue(key, value)]),
  );
}

export function hasEventNameMismatchWithUserInput(input: {
  evidenceName: string;
  extractedEventName?: string | null;
}): boolean {
  if (!input.extractedEventName?.trim()) return false;
  const userName = normalizeForCompare(input.evidenceName);
  const extractedName = normalizeForCompare(input.extractedEventName);
  if (!userName || !extractedName || userName === extractedName) return false;
  return !userName.includes(extractedName) && !extractedName.includes(userName);
}

function buildFieldConfidence(input: {
  evidenceName: string;
  normalizedFields: JsonRecord;
  studentProfileFields: JsonRecord;
  warningCodes: Set<string>;
  matchedEventId?: string | null;
  matchedParticipantId?: string | null;
}) {
  const eventName = stringValue(
    input.normalizedFields.event_name ?? input.normalizedFields.eventName,
  );
  const issueDate = stringValue(
    input.normalizedFields.issue_date ?? input.normalizedFields.issueDate,
  );
  const activityDate = stringValue(
    input.normalizedFields.activity_date ?? input.normalizedFields.activityDate,
  );
  const organizer = stringValue(input.normalizedFields.organizer);
  const organizerLevel = stringValue(
    input.normalizedFields.organizer_level ?? input.normalizedFields.organizerLevel,
  );
  const studentName = stringValue(
    input.normalizedFields.student_name ?? input.normalizedFields.studentName,
  );
  const studentCode = stringValue(
    input.normalizedFields.student_code ?? input.normalizedFields.studentCode,
  );

  const confidence: Record<string, number> = {};

  if (eventName) {
    confidence.eventName = hasEventNameMismatchWithUserInput({
      evidenceName: input.evidenceName,
      extractedEventName: eventName,
    })
      ? 0.42
      : input.matchedEventId
        ? 0.84
        : 0.62;
  }
  if (organizer) confidence.organizer = input.warningCodes.has('MISSING_ORGANIZER') ? 0.45 : 0.81;
  if (organizerLevel) confidence.organizerLevel = organizerLevel === 'unknown' ? 0.25 : 0.52;
  if (issueDate) confidence.issueDate = hasTimePrefix(issueDate) ? 0.68 : 0.75;
  confidence.activityDate = activityDate ? (hasTimePrefix(activityDate) ? 0.55 : 0.64) : 0.3;
  if (studentName) confidence.studentName = input.studentProfileFields.studentName ? 0.95 : 0.45;
  if (studentCode) confidence.studentCode = input.studentProfileFields.studentCode ? 0.98 : 0.72;
  if (stringValue(input.normalizedFields.class_name ?? input.normalizedFields.className)) {
    confidence.className = input.studentProfileFields.className ? 0.95 : 0.45;
  }
  if (stringValue(input.normalizedFields.faculty)) {
    confidence.faculty = input.studentProfileFields.faculty ? 0.95 : 0.42;
  }
  if (typeof input.normalizedFields.gpa === 'number') confidence.gpa = 0.78;

  return confidence;
}

function buildMetricSuggestions(fields: JsonRecord): JsonRecord {
  const gpa = numberValue(fields.gpa);
  if (gpa === undefined) return {};

  return {
    gpa: {
      value: gpa,
      scale: gpa <= 4 ? 4 : 10,
      source: 'smartreader',
      confidence: 0.78,
      requiresConfirmation: true,
    },
  };
}

function buildAcademicLayer(input: {
  criterion: Criterion | string;
  applicationMetrics: Array<{
    metricType: string;
    value: number | string | null;
    scale?: number | null;
  }>;
  targetLevel?: string | null;
  metricSuggestions: JsonRecord;
}): JsonRecord | undefined {
  if (input.criterion !== 'academic') return undefined;

  const metric = input.applicationMetrics.find((item) => item.metricType === 'gpa');
  const userGpa = metric ? (numberValue(metric.value) ?? null) : null;
  const suggestion = isRecord(input.metricSuggestions.gpa) ? input.metricSuggestions.gpa : null;
  const threshold = gpaThreshold(input.targetLevel);

  return {
    userInput: {
      gpa: userGpa,
      gpaDisplay: userGpa === null ? 'Chưa nhập' : String(userGpa),
      scale: metric?.scale ?? 4,
    },
    smartReaderSuggestion: suggestion,
    threshold: threshold
      ? {
          value: threshold,
          scale: 4,
          level: input.targetLevel ?? 'school',
        }
      : null,
    message: suggestion
      ? `SmartReader phát hiện GPA ${suggestion.value}/${suggestion.scale}. Vui lòng xác nhận trước khi dùng để tiền kiểm.`
      : 'Chưa có gợi ý GPA từ SmartReader.',
  };
}

function gpaThreshold(level?: string | null): number | null {
  if (level === 'central') return 3.4;
  if (level === 'university' || level === 'city') return 3.2;
  if (level === 'school') return 3;
  return null;
}

function presentFieldValue(key: string, value: unknown): PresentedFieldValue | unknown {
  if (dateFieldKeys.has(key)) {
    const date = presentDate(value);
    return date ?? value;
  }

  if (key === 'organizer_level' || key === 'organizerLevel') {
    const raw = stringValue(value);
    if (!raw) return value;
    return {
      raw,
      display: organizerLevelLabels[raw] ?? raw,
      label: organizerLevelLabels[raw] ?? raw,
    };
  }

  return value;
}

function presentDate(value: unknown) {
  const raw = stringValue(value);
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return {
      raw,
      display: `${iso[3]}/${iso[2]}/${iso[1]}`,
      hasTime: /[T ]\d{1,2}:\d{2}/.test(raw),
    };
  }

  const vietnamese = raw.match(/(?:(\d{1,2}):(\d{2})\s*)?(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (vietnamese) {
    const [, hour, minute, day, month, year] = vietnamese;
    return {
      raw,
      display: `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`,
      hasTime: Boolean(hour && minute),
    };
  }

  return { raw, display: raw, hasTime: false };
}

function warningCodeSet(value: unknown) {
  if (!Array.isArray(value)) return new Set<string>();
  return new Set(
    value
      .map((item) => (isRecord(item) ? stringValue(item.code) : stringValue(item)))
      .filter((item): item is string => Boolean(item)),
  );
}

function hasTimePrefix(value: string): boolean {
  return /^\s*\d{1,2}:\d{2}/.test(value) || /[T ]\d{1,2}:\d{2}/.test(value);
}

function normalizeForCompare(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/đ/g, 'd')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function removeEmpty<T extends JsonRecord>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, nested]) => nested !== undefined && nested !== null && nested !== '',
    ),
  ) as T;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

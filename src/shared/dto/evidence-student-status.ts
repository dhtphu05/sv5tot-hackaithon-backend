import type { Criterion, EvidenceSourceType, EvidenceStatus, IndexingStatus, Prisma } from '@prisma/client';

export type EvidenceStudentStatusCode =
  | 'official_match_found'
  | 'official_match_not_found'
  | 'similar_name_found'
  | 'evidence_read'
  | 'needs_more_info'
  | 'needs_human_verification'
  | 'unreadable_file'
  | 'recorded_waiting_review';

export type EvidenceStudentNextAction =
  | 'add_to_application'
  | 'upload_evidence'
  | 'upload_more'
  | 'add_note'
  | 'wait_for_review'
  | 'retry_upload'
  | 'view_evidence';

export type EvidenceStudentStatus = {
  code: EvidenceStudentStatusCode;
  label: string;
  message: string;
  nextAction: EvidenceStudentNextAction;
  severity: 'success' | 'info' | 'warning' | 'error';
  source: 'official_matching' | 'smartreader' | 'manual' | 'review';
};

export type EvidenceWarning = {
  code: string;
  label: string;
  message: string;
};

export type EvidenceMissingField = {
  field: string;
  label: string;
  message: string;
};

export type EvidenceReadableSummary = {
  studentName?: string | null;
  studentCode?: string | null;
  className?: string | null;
  faculty?: string | null;
  documentType?: string | null;
  eventName?: string | null;
  organizer?: string | null;
  organizerLevel?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  issueDate?: string | null;
  activityDate?: string | null;
  convertedValue?: number | null;
  convertedUnit?: string | null;
  volunteerDays?: number | null;
  certificateType?: string | null;
  languageScore?: string | null;
  gpa?: number | null;
  conductScore?: number | null;
  officialDocumentNo?: string | null;
};

export type EvidenceMatchingStatus = {
  code: 'official_match_found' | 'official_match_not_found' | 'similar_name_found' | 'none';
  matchedEventId?: string | null;
  matchedEventName?: string | null;
  matchedParticipantId?: string | null;
  message: string;
};

export const evidenceStudentStatuses: Record<EvidenceStudentStatusCode, EvidenceStudentStatus> = {
  official_match_found: {
    code: 'official_match_found',
    label: 'Đã tìm thấy trong danh sách chính thức',
    message: 'Bạn có tên trong danh sách xác nhận của hoạt động này.',
    nextAction: 'add_to_application',
    severity: 'success',
    source: 'official_matching',
  },
  official_match_not_found: {
    code: 'official_match_not_found',
    label: 'Chưa tìm thấy trong danh sách chính thức',
    message: 'Bạn vẫn có thể upload minh chứng để cán bộ xác minh.',
    nextAction: 'upload_evidence',
    severity: 'info',
    source: 'official_matching',
  },
  similar_name_found: {
    code: 'similar_name_found',
    label: 'Có hoạt động tương tự',
    message: 'Hệ thống tìm thấy hoạt động có tên gần giống. Vui lòng kiểm tra trước khi thêm vào hồ sơ.',
    nextAction: 'add_to_application',
    severity: 'info',
    source: 'official_matching',
  },
  evidence_read: {
    code: 'evidence_read',
    label: 'Đã đọc minh chứng',
    message: 'Hệ thống đã đọc được các thông tin chính từ file.',
    nextAction: 'view_evidence',
    severity: 'success',
    source: 'smartreader',
  },
  needs_more_info: {
    code: 'needs_more_info',
    label: 'Cần bổ sung thông tin',
    message: 'Minh chứng còn thiếu một số thông tin cần thiết.',
    nextAction: 'upload_more',
    severity: 'warning',
    source: 'smartreader',
  },
  needs_human_verification: {
    code: 'needs_human_verification',
    label: 'Cần cán bộ xác minh',
    message: 'Minh chứng đã được ghi nhận và chờ cán bộ kiểm tra.',
    nextAction: 'wait_for_review',
    severity: 'info',
    source: 'review',
  },
  unreadable_file: {
    code: 'unreadable_file',
    label: 'Không đọc rõ file',
    message: 'File chưa đọc rõ. Bạn có thể tải lại bản rõ hơn.',
    nextAction: 'retry_upload',
    severity: 'error',
    source: 'smartreader',
  },
  recorded_waiting_review: {
    code: 'recorded_waiting_review',
    label: 'Đã ghi nhận, chờ xét duyệt',
    message: 'Minh chứng đã nằm trong hồ sơ của bạn.',
    nextAction: 'wait_for_review',
    severity: 'info',
    source: 'review',
  },
};

export function getEvidenceStudentStatus(code: EvidenceStudentStatusCode): EvidenceStudentStatus {
  return evidenceStudentStatuses[code];
}

export function buildOfficialMatchingStatus(input: {
  found: boolean;
  similar?: boolean;
  matchedEventId?: string | null;
  matchedEventName?: string | null;
  matchedParticipantId?: string | null;
}): EvidenceMatchingStatus {
  if (input.found) {
    const code = input.similar ? 'similar_name_found' : 'official_match_found';
    return {
      code,
      matchedEventId: input.matchedEventId ?? null,
      matchedEventName: input.matchedEventName ?? null,
      matchedParticipantId: input.matchedParticipantId ?? null,
      message:
        code === 'similar_name_found'
          ? evidenceStudentStatuses.similar_name_found.message
          : evidenceStudentStatuses.official_match_found.message,
    };
  }

  return {
    code: 'official_match_not_found',
    matchedEventId: input.matchedEventId ?? null,
    matchedEventName: input.matchedEventName ?? null,
    matchedParticipantId: null,
    message: evidenceStudentStatuses.official_match_not_found.message,
  };
}

export function buildNoMatchingStatus(): EvidenceMatchingStatus {
  return {
    code: 'none',
    matchedEventId: null,
    matchedEventName: null,
    matchedParticipantId: null,
    message: evidenceStudentStatuses.official_match_not_found.message,
  };
}

export function buildReadableSummary(fields: unknown): EvidenceReadableSummary {
  const value = isRecord(fields) ? fields : {};
  return removeEmpty({
    studentName: stringValue(value.studentName ?? value.student_name),
    studentCode: stringValue(value.studentCode ?? value.student_code),
    className: stringValue(value.className ?? value.class_name),
    faculty: stringValue(value.faculty),
    documentType: stringValue(value.documentType ?? value.document_type),
    eventName: stringValue(value.eventName ?? value.event_name),
    organizer: stringValue(value.organizer),
    organizerLevel: stringValue(value.organizerLevel ?? value.organizer_level),
    startDate: stringValue(value.startDate),
    endDate: stringValue(value.endDate),
    issueDate: stringValue(value.issueDate ?? value.issue_date),
    activityDate: stringValue(value.activityDate ?? value.activity_date),
    convertedValue: numberValue(value.convertedValue),
    convertedUnit: stringValue(value.convertedUnit),
    volunteerDays: numberValue(value.volunteerDays ?? value.volunteer_days),
    certificateType: stringValue(value.certificateType ?? value.certificate_type ?? value.document_type),
    languageScore: stringValue(value.languageScore ?? value.language_score),
    gpa: numberValue(value.gpa),
    conductScore: numberValue(value.conductScore ?? value.conduct_score),
    officialDocumentNo: stringValue(value.officialDocumentNo),
  });
}

export function mapWarning(input: unknown): EvidenceWarning {
  const rawCode = normalizeWarningCode(isRecord(input) ? input.code : input);
  const code = rawCode === 'not_matched_registry' ? 'official_match_not_found' : rawCode;
  const configured = warningCopy[code] ?? warningCopy[legacyWarningAliases[code] ?? ''];
  if (configured) return { code, ...configured };

  const fallbackMessage = isRecord(input) ? stringValue(input.message) : undefined;
  return {
    code,
    label: 'Cần kiểm tra',
    message: fallbackMessage ?? 'Minh chứng cần cán bộ kiểm tra thêm.',
  };
}

export function mapWarnings(input: unknown): EvidenceWarning[] {
  if (!Array.isArray(input)) return [];
  return input.map(mapWarning);
}

export function buildMissingFields(criterion: Criterion | string, fields: unknown, warnings: unknown): EvidenceMissingField[] {
  const readableSummary = buildReadableSummary(fields);
  const detected = new Set<string>();

  for (const warning of mapWarnings(warnings)) {
    const field = warningToMissingField[warning.code] ?? warningToMissingField[legacyWarningAliases[warning.code] ?? ''];
    if (field) detected.add(field);
  }

  for (const field of requiredFieldsForCriterion(criterion)) {
    if (!hasSummaryField(readableSummary, field)) detected.add(field);
  }

  return Array.from(detected)
    .map((field) => missingFieldCopy[field])
    .filter((item): item is EvidenceMissingField => Boolean(item));
}

export function resolveStudentStatusForCard(input: {
  sourceType: EvidenceSourceType | string;
  status: EvidenceStatus | string;
  indexingStatus: IndexingStatus | string;
  criterion: Criterion | string;
  ocrText?: string | null;
  fields?: Prisma.JsonValue | null;
  warnings?: Prisma.JsonValue | null;
  matchedEventId?: string | null;
  matchedParticipantId?: string | null;
}): EvidenceStudentStatus {
  if (input.sourceType === 'event_import') {
    return evidenceStudentStatuses.official_match_found;
  }

  if (input.indexingStatus === 'failed') {
    return evidenceStudentStatuses.unreadable_file;
  }

  if (!input.ocrText?.trim() && input.indexingStatus !== 'not_started' && input.indexingStatus !== 'pending_indexing') {
    return evidenceStudentStatuses.unreadable_file;
  }

  const missingFields = buildMissingFields(input.criterion, input.fields, input.warnings);
  const warningCodes = new Set(mapWarnings(input.warnings).map((warning) => warning.code));

  if (warningCodes.has('POSSIBLE_STUDENT_MISMATCH') || input.indexingStatus === 'needs_manual_review') {
    return evidenceStudentStatuses.needs_human_verification;
  }

  if (missingFields.length > 0) {
    return evidenceStudentStatuses.needs_more_info;
  }

  if (input.status === 'under_review') {
    return evidenceStudentStatuses.recorded_waiting_review;
  }

  if (input.ocrText?.trim()) {
    return evidenceStudentStatuses.evidence_read;
  }

  return evidenceStudentStatuses.recorded_waiting_review;
}

export function resolveMatchingStatusForCard(input: {
  matchedEventId?: string | null;
  matchedEventName?: string | null;
  matchedParticipantId?: string | null;
  warnings?: Prisma.JsonValue | null;
}): EvidenceMatchingStatus {
  const warningCodes = new Set(mapWarnings(input.warnings).map((warning) => warning.code));
  if (input.matchedEventId && input.matchedParticipantId) {
    return buildOfficialMatchingStatus({
      found: true,
      matchedEventId: input.matchedEventId,
      matchedEventName: input.matchedEventName,
      matchedParticipantId: input.matchedParticipantId,
    });
  }
  if (input.matchedEventId || warningCodes.has('official_match_not_found')) {
    return buildOfficialMatchingStatus({
      found: false,
      matchedEventId: input.matchedEventId,
      matchedEventName: input.matchedEventName,
    });
  }
  return buildNoMatchingStatus();
}

const warningCopy: Record<string, Omit<EvidenceWarning, 'code'>> = {
  missing_student_name: {
    label: 'Thiếu họ tên',
    message: 'Minh chứng chưa thể hiện rõ họ tên sinh viên.',
  },
  missing_student_code: {
    label: 'Thiếu MSSV',
    message: 'Minh chứng chưa thể hiện rõ mã số sinh viên.',
  },
  missing_issue_date: {
    label: 'Thiếu ngày cấp',
    message: 'Minh chứng chưa thể hiện rõ ngày cấp hoặc ngày ký.',
  },
  missing_organizer: {
    label: 'Thiếu đơn vị xác nhận',
    message: 'Minh chứng chưa thể hiện rõ đơn vị tổ chức hoặc xác nhận.',
  },
  missing_event_name: {
    label: 'Thiếu tên hoạt động',
    message: 'Minh chứng chưa thể hiện rõ tên hoạt động hoặc chương trình.',
  },
  missing_volunteer_days: {
    label: 'Thiếu số ngày tham gia',
    message: 'Minh chứng chưa thể hiện rõ số ngày tham gia.',
  },
  official_match_not_found: {
    label: 'Chưa tìm thấy trong danh sách chính thức',
    message: 'Bạn vẫn có thể upload minh chứng để cán bộ xác minh.',
  },
  ocr_empty_text: {
    label: 'Không đọc rõ file',
    message: 'File chưa đọc rõ. Bạn có thể tải lại bản rõ hơn.',
  },
  smartreader_warning_anh_dau_vao_nghieng: {
    label: 'File có thể bị nghiêng',
    message: 'Ảnh/PDF có thể bị nghiêng nên hệ thống đọc chưa rõ.',
  },
  smartreader_warning_anh_dau_vao_mat_goc: {
    label: 'File có thể bị mất góc',
    message: 'Ảnh/PDF có thể bị mất góc nên hệ thống đọc chưa đủ thông tin.',
  },
};

const legacyWarningAliases: Record<string, string> = {
  MISSING_STUDENT_INFO: 'missing_student_name',
  MISSING_EVENT_NAME: 'missing_event_name',
  MISSING_DATE: 'missing_issue_date',
  MISSING_ORGANIZER: 'missing_organizer',
  EVENT_MISSING_DATE: 'missing_issue_date',
  EVENT_MISSING_CONVERTED_VALUE: 'missing_volunteer_days',
  not_matched_registry: 'official_match_not_found',
  OCR_FAILED: 'ocr_empty_text',
  OCR_EMPTY_TEXT: 'ocr_empty_text',
  LOW_CONFIDENCE: 'needs_human_verification',
};

const warningToMissingField: Record<string, string> = {
  missing_student_name: 'studentName',
  missing_student_code: 'studentCode',
  missing_issue_date: 'issueDate',
  missing_organizer: 'organizer',
  missing_event_name: 'eventName',
  missing_volunteer_days: 'volunteerDays',
};

const missingFieldCopy: Record<string, EvidenceMissingField> = {
  studentName: {
    field: 'studentName',
    label: 'Họ tên',
    message: 'Minh chứng chưa thể hiện rõ họ tên sinh viên.',
  },
  studentCode: {
    field: 'studentCode',
    label: 'MSSV',
    message: 'Minh chứng chưa thể hiện rõ mã số sinh viên.',
  },
  eventName: {
    field: 'eventName',
    label: 'Tên hoạt động',
    message: 'Minh chứng chưa thể hiện rõ tên hoạt động hoặc chương trình.',
  },
  organizer: {
    field: 'organizer',
    label: 'Đơn vị xác nhận',
    message: 'Minh chứng chưa thể hiện rõ đơn vị tổ chức hoặc xác nhận.',
  },
  issueDate: {
    field: 'issueDate',
    label: 'Ngày cấp',
    message: 'Minh chứng chưa thể hiện rõ ngày cấp hoặc ngày ký.',
  },
  activityDate: {
    field: 'activityDate',
    label: 'Ngày tham gia',
    message: 'Minh chứng chưa thể hiện rõ ngày tham gia.',
  },
  volunteerDays: {
    field: 'volunteerDays',
    label: 'Số ngày tham gia',
    message: 'Minh chứng chưa thể hiện rõ số ngày tham gia.',
  },
  certificateType: {
    field: 'certificateType',
    label: 'Loại minh chứng',
    message: 'Minh chứng chưa thể hiện rõ loại chứng nhận.',
  },
  gpa: {
    field: 'gpa',
    label: 'Điểm trung bình',
    message: 'Minh chứng chưa thể hiện rõ điểm trung bình.',
  },
};

function requiredFieldsForCriterion(criterion: Criterion | string): string[] {
  if (criterion === 'volunteer') return ['eventName', 'organizer', 'volunteerDays'];
  if (criterion === 'integration') return ['eventName', 'organizer', 'issueDate'];
  if (criterion === 'academic') return ['gpa'];
  if (criterion === 'physical') return ['eventName', 'organizer'];
  if (criterion === 'ethics') return ['eventName', 'organizer'];
  return [];
}

function hasSummaryField(summary: EvidenceReadableSummary, field: string): boolean {
  if (field === 'issueDate') return Boolean(summary.issueDate || summary.activityDate);
  if (field === 'eventName') return Boolean(summary.eventName || summary.certificateType);
  if (field === 'organizer') return Boolean(summary.organizer);
  if (field === 'volunteerDays') return summary.volunteerDays !== undefined;
  return Boolean(summary[field as keyof EvidenceReadableSummary]);
}

function normalizeWarningCode(value: unknown): string {
  return String(value || 'unknown_warning').trim();
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function removeEmpty<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, nested]) => nested !== undefined && nested !== null && nested !== ''),
  ) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

import { Criterion } from '@prisma/client';
import type {
  EvidenceAnalysisFieldName,
  EvidenceDocumentAnalysisResult,
} from '../ai/evidence-analysis';

export type EvidencePrecheckStatus =
  | 'ready_for_confirmation'
  | 'needs_attention'
  | 'file_not_readable'
  | 'insufficient_information'
  | 'possible_mismatch';

export type EvidencePrecheckRecommendedAction =
  | 'confirm_card'
  | 'correct_card'
  | 'replace_file'
  | 'add_supporting_evidence'
  | 'wait_for_processing';

export type EvidencePrecheckResult = {
  evidenceId: string;
  evidenceCardRevision: number;
  generatedAt: string;
  status: EvidencePrecheckStatus;
  identifiedAs: {
    documentLabel: string;
    shortDescription: string;
  };
  completeness: {
    score: number;
    availableFields: EvidenceAnalysisFieldName[];
    missingImportantFields: EvidenceAnalysisFieldName[];
  };
  quality: {
    level: 'clear' | 'needs_check' | 'poor';
    issues: Array<
      | 'blurred'
      | 'cropped'
      | 'low_resolution'
      | 'handwriting_unclear'
      | 'multiple_documents'
      | 'page_missing'
    >;
  };
  identityCheck: {
    status: 'matched' | 'missing' | 'possible_mismatch' | 'not_applicable';
    comparedFields: string[];
  };
  relevance: Array<{
    criterion: Criterion;
    level: 'strong' | 'possible' | 'unclear';
    explanation: string;
  }>;
  warnings: Array<{
    code: string;
    severity: 'info' | 'warning' | 'blocking';
    friendlyMessage: string;
    field?: EvidenceAnalysisFieldName;
  }>;
  confirmationRequired: boolean;
  recommendedAction: EvidencePrecheckRecommendedAction;
  overallScore: number;
  sections: {
    identification: { score: number; status: 'GOOD' | 'NEEDS_CHECK' | 'MISSING'; message: string };
    identity: {
      score: number;
      status: 'MATCHED' | 'PARTIAL' | 'MISSING' | 'POSSIBLE_MISMATCH' | 'NOT_APPLICABLE';
      message: string;
    };
    organization: { score: number; status: 'GOOD' | 'NEEDS_CHECK' | 'MISSING'; message: string };
    dates: { score: number; status: 'GOOD' | 'NEEDS_CHECK' | 'MISSING'; message: string };
    criterionRelevance: { score: number; status: 'STRONG' | 'POSSIBLE' | 'UNCLEAR'; message: string };
    fileQuality: { score: number; status: 'CLEAR' | 'NEEDS_CHECK' | 'POOR'; message: string };
  };
  availableFacts: Array<{ key: string; label: string; displayValue: string }>;
  missingImportantFacts: Array<{ key: string; label: string; reason: string }>;
  documentFacts: EvidenceDocumentAnalysisResult['documentFacts'];
};

export function buildEvidencePrecheckResult(input: {
  evidenceId: string;
  revision: number;
  generatedAt: Date;
  analysis: EvidenceDocumentAnalysisResult;
  matchedProfile?: {
    fullName?: string | null;
    studentCode?: string | null;
  } | null;
  warningCodes?: string[];
}): EvidencePrecheckResult {
  const analysis = input.analysis;
  const fieldValues = Object.fromEntries(
    Object.entries(analysis.fields).map(([key, field]) => [key, field.value]),
  ) as Partial<Record<EvidenceAnalysisFieldName, string | number | null>>;
  const importantFields = importantFieldsForDocument(analysis);
  const missingImportantFields = new Set(
    analysis.documentPrecheck.completeness.missingImportantFields.filter((field) => importantFields.includes(field)),
  );
  for (const field of importantFields) {
    addIfMissing(missingImportantFields, analysis, fieldValues, field);
  }
  if (
    dateIsImportant(analysis.documentType) &&
    !hasImportantFieldValue(analysis, fieldValues, 'issue_date') &&
    !hasImportantFieldValue(analysis, fieldValues, 'activity_date')
  ) {
    missingImportantFields.add('issue_date');
  }
  const quality = resolveEffectiveQuality(analysis, fieldValues);

  const identityCheck = buildIdentityCheck({
    fields: fieldValues,
    profile: input.matchedProfile,
    warnings: [...analysis.warnings.map((warning) => warning.code), ...(input.warningCodes ?? [])],
  });
  const warnings = buildEvidencePrecheckWarnings({
    analysis,
    qualityLevel: quality.level,
    identityStatus: identityCheck.status,
    missingImportantFields: Array.from(missingImportantFields),
  });
  const status = resolvePrecheckStatus({
    qualityLevel: quality.level,
    identityStatus: identityCheck.status,
    missingImportantFields: Array.from(missingImportantFields),
    warnings,
  });
  const availableFacts = buildAvailableFacts(analysis, fieldValues);
  const missingImportantFacts = Array.from(missingImportantFields).map((field) => ({
    key: field,
    label: fieldLabel(field),
    reason: `${fieldLabel(field)} là thông tin quan trọng với loại tài liệu này.`,
  }));
  const sections = buildScoreSections({
    analysis,
    qualityLevel: quality.level,
    identityStatus: identityCheck.status,
    missingImportantFields: Array.from(missingImportantFields),
  });

  return {
    evidenceId: input.evidenceId,
    evidenceCardRevision: input.revision,
    generatedAt: input.generatedAt.toISOString(),
    status,
    identifiedAs: analysis.documentPrecheck.identifiedAs,
    completeness: {
      ...analysis.documentPrecheck.completeness,
      missingImportantFields: Array.from(missingImportantFields),
    },
    quality,
    identityCheck,
    relevance: analysis.documentPrecheck.relevance,
    warnings,
    confirmationRequired: true,
    recommendedAction: recommendedActionForStatus(status),
    overallScore: Object.values(sections).reduce((sum, section) => sum + section.score, 0),
    sections,
    availableFacts,
    missingImportantFacts,
    documentFacts: analysis.documentFacts,
  };
}

function importantFieldsForDocument(analysis: EvidenceDocumentAnalysisResult): EvidenceAnalysisFieldName[] {
  switch (analysis.documentType) {
    case 'conduct_result':
      return analysis.documentFacts.conductEntries.length ? ['student_name'] : ['student_name', 'conduct_score'];
    case 'student_healthy_certificate':
      return ['student_name', 'event_name', 'organizer'];
    case 'language_certificate':
      return ['student_name', 'certificate_type', 'language_score'];
    case 'award_certificate':
    case 'award':
      return ['student_name', 'organizer', 'award_level'];
    case 'academic_result':
    case 'transcript':
      return ['student_name', 'gpa'];
    case 'volunteer_certificate':
      return ['student_name', 'event_name', 'organizer', 'volunteer_days'];
    case 'activity_certificate':
    case 'participant_confirmation':
    case 'participant_list':
    case 'certificate':
      return ['student_name', 'event_name', 'organizer'];
    default:
      return ['student_name'];
  }
}

function dateIsImportant(documentType: EvidenceDocumentAnalysisResult['documentType']) {
  return documentType !== 'conduct_result';
}

function buildAvailableFacts(
  analysis: EvidenceDocumentAnalysisResult,
  values: Partial<Record<EvidenceAnalysisFieldName, string | number | null>>,
) {
  const facts: Array<{ key: string; label: string; displayValue: string }> = [];
  for (const [key, value] of Object.entries(values) as Array<[EvidenceAnalysisFieldName, string | number | null | undefined]>) {
    if (value !== null && value !== undefined && value !== '') {
      facts.push({ key, label: fieldLabel(key), displayValue: String(value) });
    }
  }
  addFact(facts, 'identity_student_name', 'Họ tên', analysis.documentFacts.identity?.studentName ?? null);
  addFact(facts, 'identity_student_code', 'Mã sinh viên', analysis.documentFacts.identity?.studentCode ?? null);
  addFact(facts, 'identity_school_name', 'Trường', analysis.documentFacts.identity?.schoolName ?? null);
  addFact(facts, 'activity_event_name', 'Tên hoạt động', analysis.documentFacts.activity?.eventName ?? null);
  addFact(facts, 'activity_program_name', 'Chương trình', analysis.documentFacts.activity?.programName ?? null);
  addFact(facts, 'activity_location', 'Địa điểm', analysis.documentFacts.activity?.location ?? null);
  addFact(facts, 'activity_date', 'Ngày tham gia', analysis.documentFacts.activity?.activityDate ?? null);
  addFact(facts, 'issuer_name', 'Đơn vị xác nhận', analysis.documentFacts.organization?.issuerName ?? null);
  addFact(facts, 'issuer_level', 'Cấp đơn vị', analysis.documentFacts.organization?.issuerLevel ?? null);
  analysis.documentFacts.conductEntries.forEach((entry, index) => {
    const parts = [entry.semester, entry.schoolYear, entry.score, entry.classification]
      .filter((part) => part !== null && part !== undefined && part !== '')
      .map(String);
    if (parts.length) {
      facts.push({
        key: `conduct_entry_${index + 1}`,
        label: 'Kết quả rèn luyện',
        displayValue: parts.join(' - '),
      });
    }
  });
  addFact(facts, 'fitness_title', 'Danh hiệu thể lực', analysis.documentFacts.fitness.title);
  addFact(facts, 'fitness_result', 'Kết quả thể lực', analysis.documentFacts.fitness.resultLevel);
  addFact(facts, 'language_level', 'Bậc ngoại ngữ', analysis.documentFacts.language.frameworkLevel);
  addFact(facts, 'award_title', 'Tên giải thưởng', analysis.documentFacts.award.title);
  return facts;
}

function buildScoreSections(input: {
  analysis: EvidenceDocumentAnalysisResult;
  qualityLevel: EvidencePrecheckResult['quality']['level'];
  identityStatus: EvidencePrecheckResult['identityCheck']['status'];
  missingImportantFields: EvidenceAnalysisFieldName[];
}): EvidencePrecheckResult['sections'] {
  const hasIdentification = input.analysis.documentPrecheck.identifiedAs.documentLabel.trim().length > 0;
  const relevance = input.analysis.documentPrecheck.relevance[0];
  const organizationMissing = input.missingImportantFields.includes('organizer');
  const dateMissing = input.missingImportantFields.includes('issue_date') || input.missingImportantFields.includes('activity_date');
  const quality = input.qualityLevel;

  return {
    identification: {
      score: hasIdentification ? 15 : 0,
      status: hasIdentification ? 'GOOD' : 'MISSING',
      message: hasIdentification ? 'Đã nhận diện được loại tài liệu.' : 'Chưa nhận diện rõ loại tài liệu.',
    },
    identity: identitySection(input.identityStatus),
    organization: {
      score: organizationMissing ? 5 : 15,
      status: organizationMissing ? 'MISSING' : 'GOOD',
      message: organizationMissing ? 'Đơn vị xác nhận chưa rõ.' : 'Thông tin đơn vị xác nhận đủ để kiểm tra.',
    },
    dates: {
      score: dateMissing ? 5 : 15,
      status: dateMissing ? 'MISSING' : 'GOOD',
      message: dateMissing ? 'Ngày liên quan chưa rõ.' : 'Thông tin thời gian đủ để kiểm tra.',
    },
    criterionRelevance: {
      score: relevance?.level === 'strong' ? 20 : relevance?.level === 'possible' ? 12 : 6,
      status: relevance?.level === 'strong' ? 'STRONG' : relevance?.level === 'possible' ? 'POSSIBLE' : 'UNCLEAR',
      message: relevance?.explanation ?? 'Chưa đủ dữ liệu để gợi ý tiêu chí chắc chắn.',
    },
    fileQuality: {
      score: quality === 'clear' ? 15 : quality === 'needs_check' ? 8 : 0,
      status: quality === 'clear' ? 'CLEAR' : quality === 'needs_check' ? 'NEEDS_CHECK' : 'POOR',
      message:
        quality === 'clear'
          ? 'File đủ rõ để đọc thông tin chính.'
          : quality === 'needs_check'
            ? 'File đọc được nhưng vẫn cần bạn kiểm tra lại.'
            : 'File hiện khó đọc, nên thay file rõ hơn.',
    },
  };
}

function identitySection(
  status: EvidencePrecheckResult['identityCheck']['status'],
): EvidencePrecheckResult['sections']['identity'] {
  if (status === 'matched') {
    return { score: 20, status: 'MATCHED', message: 'Thông tin sinh viên khớp hồ sơ ở mức có thể đối chiếu.' };
  }
  if (status === 'possible_mismatch') {
    return { score: 0, status: 'POSSIBLE_MISMATCH', message: 'Thông tin sinh viên có dấu hiệu không khớp hồ sơ.' };
  }
  if (status === 'not_applicable') {
    return { score: 12, status: 'NOT_APPLICABLE', message: 'Chưa có đủ hồ sơ để đối chiếu danh tính tự động.' };
  }
  return { score: 6, status: 'MISSING', message: 'Tài liệu chưa thể hiện rõ danh tính sinh viên.' };
}

function addFact(
  facts: Array<{ key: string; label: string; displayValue: string }>,
  key: string,
  label: string,
  value: string | number | null,
) {
  if (value !== null && value !== undefined && value !== '') {
    facts.push({ key, label, displayValue: String(value) });
  }
}

function buildIdentityCheck(input: {
  fields: Partial<Record<EvidenceAnalysisFieldName, string | number | null>>;
  profile?: { fullName?: string | null; studentCode?: string | null } | null;
  warnings: string[];
}): EvidencePrecheckResult['identityCheck'] {
  const comparedFields: string[] = [];
  const studentName = stringValue(input.fields.student_name);
  const studentCode = stringValue(input.fields.student_code);
  if (studentName && input.profile?.fullName) comparedFields.push('họ tên');
  if (studentCode && input.profile?.studentCode) comparedFields.push('mã sinh viên');
  if (!studentName && !studentCode) return { status: 'missing', comparedFields };
  if (input.warnings.some(isStrongStudentMismatchWarning)) {
    return { status: 'possible_mismatch', comparedFields };
  }
  if (!input.profile?.fullName && !input.profile?.studentCode) {
    return { status: 'not_applicable', comparedFields };
  }
  return { status: comparedFields.length ? 'matched' : 'missing', comparedFields };
}

function buildEvidencePrecheckWarnings(input: {
  analysis: EvidenceDocumentAnalysisResult;
  qualityLevel: EvidencePrecheckResult['quality']['level'];
  identityStatus: EvidencePrecheckResult['identityCheck']['status'];
  missingImportantFields: EvidenceAnalysisFieldName[];
}): EvidencePrecheckResult['warnings'] {
  const warnings = new Map<string, EvidencePrecheckResult['warnings'][number]>();
  for (const warning of input.analysis.warnings) {
    warnings.set(warning.code, {
      code: warning.code,
      severity: warning.severity,
      friendlyMessage: friendlyWarningMessage(warning.code, warning.field, warning.message),
      field: warning.field,
    });
  }
  for (const field of input.missingImportantFields) {
    warnings.set(`missing_${field}`, {
      code: `missing_${field}`,
      severity: 'warning',
      friendlyMessage: `${fieldLabel(field)} chưa rõ trong tài liệu.`,
      field,
    });
  }
  if (input.qualityLevel === 'poor') {
    warnings.set('file_quality_poor', {
      code: 'file_quality_poor',
      severity: 'blocking',
      friendlyMessage: 'File hiện khó đọc. Bạn nên thay file rõ hơn trước khi xác nhận.',
    });
  }
  if (input.identityStatus === 'possible_mismatch') {
    warnings.set('possible_student_mismatch', {
      code: 'possible_student_mismatch',
      severity: 'blocking',
      friendlyMessage: 'Thông tin sinh viên trong tài liệu có dấu hiệu không khớp hồ sơ.',
    });
  }
  return Array.from(warnings.values());
}

function resolvePrecheckStatus(input: {
  qualityLevel: EvidencePrecheckResult['quality']['level'];
  identityStatus: EvidencePrecheckResult['identityCheck']['status'];
  missingImportantFields: EvidenceAnalysisFieldName[];
  warnings: EvidencePrecheckResult['warnings'];
}): EvidencePrecheckStatus {
  if (input.qualityLevel === 'poor') return 'file_not_readable';
  if (input.identityStatus === 'possible_mismatch') return 'possible_mismatch';
  if (input.warnings.some((warning) => warning.severity === 'blocking')) return 'needs_attention';
  if (input.missingImportantFields.length >= 3) return 'insufficient_information';
  if (input.missingImportantFields.length > 0 || input.qualityLevel === 'needs_check') {
    return 'needs_attention';
  }
  return 'ready_for_confirmation';
}

function recommendedActionForStatus(status: EvidencePrecheckStatus): EvidencePrecheckRecommendedAction {
  if (status === 'file_not_readable') return 'replace_file';
  if (status === 'insufficient_information' || status === 'possible_mismatch') return 'correct_card';
  if (status === 'needs_attention') return 'correct_card';
  return 'confirm_card';
}

function addIfMissing(
  fields: Set<EvidenceAnalysisFieldName>,
  analysis: EvidenceDocumentAnalysisResult,
  values: Partial<Record<EvidenceAnalysisFieldName, string | number | null>>,
  field: EvidenceAnalysisFieldName,
) {
  if (!hasImportantFieldValue(analysis, values, field)) fields.add(field);
}

function hasImportantFieldValue(
  analysis: EvidenceDocumentAnalysisResult,
  values: Partial<Record<EvidenceAnalysisFieldName, string | number | null>>,
  field: EvidenceAnalysisFieldName,
) {
  const direct = values[field];
  if (direct !== null && direct !== undefined && direct !== '') return true;
  const facts = analysis.documentFacts;
  switch (field) {
    case 'student_name':
      return Boolean(facts.identity?.studentName);
    case 'student_code':
      return Boolean(facts.identity?.studentCode);
    case 'event_name':
      return Boolean(facts.activity?.eventName || facts.activity?.programName || facts.documentTitle || facts.fitness?.title);
    case 'organizer':
      return Boolean(facts.organization?.issuerName);
    case 'organizer_level':
      return Boolean(facts.organization?.issuerLevel);
    case 'issue_date':
    case 'activity_date':
      return Boolean(facts.activity?.activityDate);
    case 'certificate_type':
      return analysis.documentType !== 'other' || Boolean(facts.documentTitle);
    case 'conduct_score':
      return facts.conductEntries.some((entry) => typeof entry.score === 'number');
    default:
      return false;
  }
}

function resolveEffectiveQuality(
  analysis: EvidenceDocumentAnalysisResult,
  values: Partial<Record<EvidenceAnalysisFieldName, string | number | null>>,
): EvidencePrecheckResult['quality'] {
  const quality = analysis.documentPrecheck.quality;
  if (quality.level !== 'poor') return quality;
  if (!hasReadableDocumentSignals(analysis, values)) return quality;
  return { ...quality, level: 'needs_check' };
}

function hasReadableDocumentSignals(
  analysis: EvidenceDocumentAnalysisResult,
  values: Partial<Record<EvidenceAnalysisFieldName, string | number | null>>,
) {
  const directValueCount = Object.values(values).filter((value) => value !== null && value !== undefined && value !== '').length;
  const factValueCount = [
    analysis.documentFacts.documentTitle,
    analysis.documentFacts.identity?.studentName,
    analysis.documentFacts.identity?.studentCode,
    analysis.documentFacts.identity?.schoolName,
    analysis.documentFacts.activity?.eventName,
    analysis.documentFacts.activity?.programName,
    analysis.documentFacts.activity?.location,
    analysis.documentFacts.activity?.activityDate,
    analysis.documentFacts.organization?.issuerName,
    analysis.documentFacts.organization?.issuerLevel,
    analysis.documentFacts.fitness?.title,
    analysis.documentFacts.fitness?.resultLevel,
    analysis.documentFacts.fitness?.sportName,
  ].filter((value) => value !== null && value !== undefined && value !== '').length;
  const hasIdentification = analysis.documentPrecheck.identifiedAs.documentLabel.trim().length > 0;
  return hasIdentification && directValueCount + factValueCount >= 3;
}

function stringValue(value: string | number | null | undefined) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
}

function isStrongStudentMismatchWarning(code: string) {
  const normalized = code.toLowerCase();
  return (
    normalized.includes('wrong_student') ||
    normalized.includes('student_mismatch') ||
    normalized.includes('possible_student_mismatch') ||
    normalized.includes('different_student') ||
    normalized.includes('sai_sinh_vien') ||
    normalized.includes('sai sinh viên')
  );
}

function friendlyWarningMessage(code: string, field?: EvidenceAnalysisFieldName, fallback?: string) {
  if (/blur|quality|readable/i.test(code)) return 'File có dấu hiệu khó đọc, bạn nên kiểm tra lại.';
  if (/mismatch|conflict|wrong_student/i.test(code)) {
    return 'Thông tin sinh viên trong tài liệu có thể chưa khớp hồ sơ.';
  }
  if (field) return `${fieldLabel(field)} cần bạn kiểm tra lại.`;
  return fallback?.trim() || 'Có thông tin cần bạn kiểm tra trước khi xác nhận.';
}

function fieldLabel(field: EvidenceAnalysisFieldName) {
  const labels: Record<EvidenceAnalysisFieldName, string> = {
    student_name: 'Họ tên',
    student_code: 'Mã sinh viên',
    class_name: 'Lớp',
    faculty: 'Khoa',
    event_name: 'Tên hoạt động',
    organizer: 'Đơn vị tổ chức',
    organizer_level: 'Cấp tổ chức',
    issue_date: 'Ngày cấp',
    activity_date: 'Ngày tham gia',
    award_level: 'Mức giải thưởng',
    volunteer_days: 'Số ngày tham gia',
    certificate_type: 'Loại chứng nhận',
    language_score: 'Điểm ngoại ngữ',
    gpa: 'GPA',
    conduct_score: 'Điểm rèn luyện',
  };
  return labels[field];
}

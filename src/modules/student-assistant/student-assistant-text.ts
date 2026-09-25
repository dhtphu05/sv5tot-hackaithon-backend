import type { StudentAssistantContext } from './student-assistant.types';

const statusLabels: Record<string, string> = {
  needs_manual_review: 'Cần bạn kiểm tra thêm',
  ocr_processing: 'Đang đọc nội dung',
  pending_indexing: 'Đang chờ xử lý',
  extracting: 'Đang chuẩn hóa thông tin',
  checking_registry: 'Đang đối chiếu dữ liệu',
  indexed: 'Đã đọc xong',
  failed: 'Chưa đọc được minh chứng',
  pending: 'Cần kiểm tra',
  correction_required: 'Đã có chỉnh sửa cần xác nhận',
  confirmed: 'Đã xác nhận',
  not_required: 'Không cần xác nhận',
  ready_for_confirmation: 'Sẵn sàng để bạn xác nhận',
  needs_attention: 'Cần bạn kiểm tra thêm',
  file_not_readable: 'File khó đọc',
  insufficient_information: 'Thiếu thông tin quan trọng',
  possible_mismatch: 'Có thể chưa khớp hồ sơ',
  confirm_card: 'xác nhận Thẻ minh chứng',
  correct_card: 'chỉnh lại thông tin trên Thẻ minh chứng',
  replace_file: 'thay file rõ hơn',
  replace_evidence_file: 'thay file rõ hơn',
  add_supporting_evidence: 'bổ sung minh chứng hỗ trợ',
  wait_for_processing: 'chờ hệ thống đọc xong',
};

const internalTerms =
  /\b(?:Prisma|DTO|OpenAI|SmartReader|OCR|database|provider|prompt|tool|camelCase|snake_case|IndexingStatus|EvidenceCard|rawAiResponse|rawResponseJson)\b|[a-z]+_[a-z0-9_]+/i;

export function friendlyStudentValue(value: unknown): string {
  const text = String(value ?? '').trim();
  return statusLabels[text] ?? text;
}

export function sanitizeStudentAssistantAnswer(
  answer: string,
  context: StudentAssistantContext,
  message: string,
) {
  const direct = ensureDirectAnswer(answer.replace(/\s+/g, ' ').trim(), context, message);
  if (!direct || internalTerms.test(direct) || containsUnsafeClaim(direct)) {
    return null;
  }
  return direct;
}

export function containsUnsafeClaim(text: string) {
  return /(chắc chắn đạt|đảm bảo đạt|đã được duyệt|ai đã duyệt|kết quả chính thức là|tôi đã thay đổi|đã nộp giúp bạn|deadline đã đổi)/i.test(
    text,
  );
}

export function buildFriendlyDeterministicAnswer(
  context: StudentAssistantContext,
  message: string,
): string {
  const normalized = normalizeText(message).toLowerCase();
  const primaryAction = context.primaryAction?.allowed
    ? context.primaryAction
    : context.allowedActions.find((action) => action.allowed);
  const actionText = primaryAction ? ` Bước phù hợp là ${primaryAction.label}.` : '';
  const boundary = context.boundaries.requiresOfficerForOfficialDecision
    ? ' Kết quả chính thức vẫn do cán bộ hoặc Hội đồng xác nhận.'
    : '';
  if (context.contextType === 'evidence_card' && isIdentifyQuestion(normalized)) {
    const evidenceName =
      context.facts.find((fact) => fact.id === 'evidence-name')?.value ||
      context.title.replace(/^Trợ lý minh chứng:\s*/i, '');
    return `Đây là minh chứng về ${friendlyStudentValue(evidenceName)}. ${context.deterministicSummary}${actionText}${boundary}`;
  }
  if (context.contextType === 'supplement') {
    return truncateWords(`${context.deterministicSummary}${actionText}${boundary}`, 160);
  }
  if (context.contextType === 'criteria') {
    const source = context.facts.find((fact) => fact.type === 'criteria_source');
    const sourceText = source ? ` Nội dung dựa trên ${source.value}.` : '';
    return truncateWords(`${context.deterministicSummary}${actionText}${sourceText}${boundary}`, 140);
  }
  return truncateWords(`${context.deterministicSummary}${actionText}${boundary}`, 100);
}

function ensureDirectAnswer(answer: string, context: StudentAssistantContext, message: string) {
  if (context.contextType !== 'evidence_card' || !isIdentifyQuestion(normalizeText(message).toLowerCase())) {
    return answer;
  }
  if (/^(đây là|minh chứng này là|tài liệu này là)/i.test(answer)) return answer;
  const evidenceName =
    context.facts.find((fact) => fact.id === 'evidence-name')?.value ||
    context.title.replace(/^Trợ lý minh chứng:\s*/i, '');
  return `Đây là minh chứng về ${friendlyStudentValue(evidenceName)}. ${answer}`;
}

function isIdentifyQuestion(message: string) {
  return (
    message.includes('đây là') ||
    message.includes('minh chứng gì') ||
    message.includes('tài liệu gì') ||
    message.includes('giấy gì')
  );
}

function truncateWords(text: string, maxWords: number) {
  const words = text.trim().split(/\s+/);
  return words.length <= maxWords ? text.trim() : `${words.slice(0, maxWords).join(' ')}.`;
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

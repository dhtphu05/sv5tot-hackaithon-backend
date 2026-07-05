const officialResultCaveat =
  'Hệ thống chỉ hỗ trợ tiền kiểm và giải thích. Kết quả chính thức do cán bộ/Hội đồng xác nhận.';

const bannedStudentPhrases = [
  /AI chấm/gi,
  /AI kết luận/gi,
  /AI đánh giá hợp lệ/gi,
  /Hợp lệ\s+\d+%/gi,
  /Không hợp lệ\s+\d+%/gi,
  /(confidence|độ tin cậy)\s*:?\s*\d+%/gi,
  /Chắc chắn đạt/gi,
  /Chắc chắn rớt/gi,
];

const resultQuestionPattern =
  /(đạt|rớt|đậu|trượt|pass|fail|kết quả|chính thức|thiếu gì|còn thiếu|gap|bổ sung|minh chứng|hồ sơ)/i;

export function applySmartbotGuardrails(answer: string, question: string): string {
  const cleaned = redactUnsafeSmartbotClaims(answer);

  if (resultQuestionPattern.test(question) && !cleaned.includes(officialResultCaveat)) {
    return `${cleaned}\n\n${officialResultCaveat}`;
  }

  return cleaned;
}

export function redactUnsafeSmartbotClaims(answer: string): string {
  return bannedStudentPhrases.reduce(
    (current, pattern) => current.replace(pattern, 'cần cán bộ xác minh'),
    answer,
  );
}

export { officialResultCaveat };

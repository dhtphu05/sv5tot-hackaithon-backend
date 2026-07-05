import { describe, expect, it } from 'vitest';
import { applySmartbotGuardrails, officialResultCaveat } from '../../src/modules/chatbot/chatbot.guardrails';

describe('applySmartbotGuardrails', () => {
  it('removes unsafe result wording and appends caveat for gap questions', () => {
    const answer = applySmartbotGuardrails(
      'AI chấm hồ sơ này. Chắc chắn đạt. Confidence 82%',
      'Hồ sơ cấp Trường của em còn thiếu gì?',
    );

    expect(answer).not.toContain('AI chấm');
    expect(answer).not.toContain('Chắc chắn đạt');
    expect(answer).not.toContain('82%');
    expect(answer).toContain(officialResultCaveat);
  });
});

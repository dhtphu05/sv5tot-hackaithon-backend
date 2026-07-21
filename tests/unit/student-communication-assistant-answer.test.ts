import { describe, expect, it, vi } from 'vitest';
import {
  buildDeterministicAnswer,
  OpenAiStudentAnswerProvider,
  parseAndValidateAnswer,
} from '../../src/modules/student-assistant/student-assistant-answer';
import type { StudentAssistantContext } from '../../src/modules/student-assistant/student-assistant.types';

function context(): StudentAssistantContext {
  return {
    contextType: 'supplement',
    contextId: 'task-1',
    contextVersion: 'ctx-1',
    generatedAt: '2026-07-21T00:00:00.000Z',
    title: 'Trợ lý bổ sung hồ sơ',
    deterministicSummary:
      'Cán bộ đang yêu cầu bổ sung minh chứng học tập. Bạn cần hoàn tất đúng mục được mở trước khi gửi lại.',
    facts: [
      {
        id: 'supplement-message',
        type: 'officer_request',
        label: 'Yêu cầu từ cán bộ',
        value: 'Bổ sung bảng điểm rõ hơn.',
        verified: true,
      },
    ],
    warnings: [],
    primaryAction: {
      id: 'resubmit-supplement:task-1',
      type: 'resubmit_supplement',
      label: 'Gửi lại bổ sung',
      destination: {
        route: '/app/application',
        query: { reviewTaskId: 'task-1', mode: 'supplement' },
      },
      allowed: true,
    },
    allowedActions: [
      {
        id: 'resubmit-supplement:task-1',
        type: 'resubmit_supplement',
        label: 'Gửi lại bổ sung',
        destination: {
          route: '/app/application',
          query: { reviewTaskId: 'task-1', mode: 'supplement' },
        },
        allowed: true,
      },
    ],
    suggestedQuestions: [],
    boundaries: {
      canAnswerAboutCriteria: true,
      canAnswerAboutEvidence: true,
      canAnswerAboutEvents: false,
      canAnswerAboutSupplement: true,
      requiresOfficerForOfficialDecision: true,
    },
  };
}

describe('student communication assistant answer validation', () => {
  it('accepts a bounded answer that references known facts and allowed actions', () => {
    const parsed = parseAndValidateAnswer(
      JSON.stringify({
        answer:
          'Bạn cần bổ sung đúng bảng điểm theo yêu cầu cán bộ. Sau khi minh chứng sẵn sàng, hãy gửi lại để cán bộ xem tiếp.',
        intent: 'explain_supplement',
        sourceRefs: [{ factId: 'supplement-message', label: 'Yêu cầu từ cán bộ' }],
        suggestedActionId: 'resubmit-supplement:task-1',
        requiresOfficerClarification: false,
      }),
      context(),
    );

    expect(parsed.suggestedActionId).toBe('resubmit-supplement:task-1');
    expect(parsed.sourceRefs).toHaveLength(1);
  });

  it('falls back when the model references unknown facts or actions', () => {
    const fallback = buildDeterministicAnswer(context(), '');
    const parsed = parseAndValidateAnswer(
      JSON.stringify({
        answer: 'Bạn có thể xử lý yêu cầu bổ sung trong hồ sơ hiện tại.',
        intent: 'explain_supplement',
        sourceRefs: [{ factId: 'made-up', label: 'Nguồn không có' }],
        suggestedActionId: 'fake-action',
        requiresOfficerClarification: false,
      }),
      context(),
    );

    expect(parsed).toEqual(fallback);
  });

  it('falls back when the model claims official approval', () => {
    const parsed = parseAndValidateAnswer(
      JSON.stringify({
        answer: 'AI đã duyệt minh chứng và chắc chắn đạt kết quả chính thức.',
        intent: 'explain_supplement',
        sourceRefs: [{ factId: 'supplement-message', label: 'Yêu cầu từ cán bộ' }],
        suggestedActionId: 'resubmit-supplement:task-1',
        requiresOfficerClarification: false,
      }),
      context(),
    );

    expect(parsed.answer).toContain('Kết quả chính thức vẫn do cán bộ');
  });

  it('uses strict OpenAI structured output settings and a safety identifier', async () => {
    const output = JSON.stringify({
      answer:
        'Bạn cần bổ sung đúng bảng điểm theo yêu cầu cán bộ. Sau khi sẵn sàng, hãy gửi lại để cán bộ xem tiếp.',
      intent: 'explain_supplement',
      sourceRefs: [{ factId: 'supplement-message', label: 'Yêu cầu từ cán bộ', destination: null }],
      suggestedActionId: 'resubmit-supplement:task-1',
      requiresOfficerClarification: false,
    });
    const create = vi.fn().mockResolvedValue(streamEvents(output));
    const provider = new OpenAiStudentAnswerProvider({
      responses: { create },
    } as never);
    const deltas: string[] = [];

    const result = await provider.stream({
      context: context(),
      message: 'Tôi cần làm gì?',
      safetyIdentifier: 'student_safe_hash',
      onDelta: async (delta) => {
        deltas.push(delta.text);
      },
    });

    expect(result.answer.suggestedActionId).toBe('resubmit-supplement:task-1');
    expect(deltas.join('')).toBe(result.answer.answer);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'test-student-assistant-model',
        store: false,
        stream: true,
        max_output_tokens: 1200,
        reasoning: { effort: 'minimal' },
        safety_identifier: 'student_safe_hash',
        text: expect.objectContaining({
          format: expect.objectContaining({
            type: 'json_schema',
            strict: true,
            name: 'student_assistant_answer',
          }),
        }),
      }),
      expect.objectContaining({ timeout: expect.any(Number), maxRetries: expect.any(Number) }),
    );
  });
});

async function* streamEvents(text: string) {
  yield { type: 'response.output_text.delta', delta: text };
  yield { type: 'response.completed', response: { usage: { total_tokens: 12 } } };
}

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

  it('falls back when the model exposes internal implementation language', () => {
    const parsed = parseAndValidateAnswer(
      JSON.stringify({
        answer: 'Trạng thái needs_manual_review đến từ OCR provider và rawResponseJson.',
        intent: 'explain_supplement',
        sourceRefs: [{ factId: 'supplement-message', label: 'Yêu cầu từ cán bộ' }],
        suggestedActionId: 'resubmit-supplement:task-1',
        requiresOfficerClarification: false,
      }),
      context(),
    );

    expect(parsed.answer).not.toContain('needs_manual_review');
    expect(parsed.answer).not.toContain('rawResponseJson');
  });

  it('does not answer criteria questions from a non-criteria context without criteria facts', () => {
    const parsed = parseAndValidateAnswer(
      JSON.stringify({
        answer: 'Cấp Đại học Đà Nẵng yêu cầu GPA 3,2.',
        intent: 'explain_criterion',
        sourceRefs: [{ factId: 'supplement-message', label: 'Yêu cầu từ cán bộ' }],
        suggestedActionId: 'resubmit-supplement:task-1',
        requiresOfficerClarification: false,
      }),
      context(),
      'Cấp Đại học Đà Nẵng cần GPA bao nhiêu?',
    );

    expect(parsed.intent).toBe('out_of_scope');
    expect(parsed.answer).toContain('không thuộc nội dung');
  });

  it('falls back when criteria answer invents a number not present in backend facts', () => {
    const criteriaContext: StudentAssistantContext = {
      ...context(),
      contextType: 'criteria',
      title: 'Trợ lý tiêu chí cấp Đại học Đà Nẵng',
      deterministicSummary: 'Tiêu chí Học tập yêu cầu GPA từ 3,2/4,0 và một thành tích học thuật bổ sung.',
      facts: [
        {
          id: 'criteria:academic:gpa',
          type: 'criteria_rule',
          label: 'Học tập tốt',
          value: 'GPA từ 3,2/4,0 và một thành tích học thuật bổ sung',
          verified: true,
        },
      ],
      primaryAction: null,
      allowedActions: [],
    };
    const parsed = parseAndValidateAnswer(
      JSON.stringify({
        answer: 'Bạn cần GPA từ 3,5/4,0 và một thành tích học thuật bổ sung.',
        intent: 'explain_criterion',
        sourceRefs: [{ factId: 'criteria:academic:gpa', label: 'Học tập tốt' }],
        requiresOfficerClarification: false,
      }),
      criteriaContext,
      'Cấp Đại học Đà Nẵng cần GPA bao nhiêu?',
    );

    expect(parsed.answer).toContain('3,2/4,0');
    expect(parsed.answer).not.toContain('3,5');
  });

  it('answers identify-evidence questions directly in the first sentence', () => {
    const evidenceContext = {
      ...context(),
      contextType: 'evidence_card' as const,
      title: 'Trợ lý minh chứng: Học bổng Synopsys',
      facts: [
        {
          id: 'evidence-name',
          type: 'evidence_field' as const,
          label: 'Tên minh chứng',
          value: 'Học bổng Synopsys IC Design Scholarship 2025',
          verified: true,
        },
      ],
    };

    const parsed = parseAndValidateAnswer(
      JSON.stringify({
        answer: 'Thông tin này được lấy từ dữ liệu minh chứng trong hồ sơ.',
        intent: 'explain_evidence',
        sourceRefs: [{ factId: 'evidence-name', label: 'Tên minh chứng' }],
        suggestedActionId: 'resubmit-supplement:task-1',
        requiresOfficerClarification: false,
      }),
      evidenceContext,
      'Đây là minh chứng gì?',
    );

    expect(parsed.answer.startsWith('Đây là minh chứng về Học bổng Synopsys')).toBe(true);
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

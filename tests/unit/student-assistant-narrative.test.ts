import { describe, expect, it } from 'vitest';
import { MockAssistantNarrativeProvider, validateFinalNarrative } from '../../src/modules/applications/student-assistant/student-assistant-narrative';
import type { StudentAssistantContext } from '../../src/modules/applications/student-assistant/student-assistant.dto';

function context(): StudentAssistantContext {
  return {
    contextVersion: 'ctx-1',
    generatedAt: '2026-07-21T00:00:00.000Z',
    state: 'evidence_confirmation_required',
    greeting: {
      title: 'Xin chào, An',
      deterministicMessage: 'Hồ sơ cấp Trường đang được theo dõi.',
    },
    application: {
      id: 'app-1',
      status: 'draft',
      targetLevel: 'school',
      readinessScore: 60,
      precheckIsStale: false,
    },
    criterionSummary: [],
    nextBestAction: {
      id: 'confirm-evidence:ev-1',
      type: 'confirm_evidence',
      priority: 3,
      title: 'Kiểm tra thông tin minh chứng',
      deterministicDescription: 'Minh chứng cần xác nhận.',
      ctaLabel: 'Kiểm tra minh chứng',
      destination: { route: '/app/application', query: { evidenceId: 'ev-1', mode: 'confirm' } },
      applicationId: 'app-1',
      evidenceId: 'ev-1',
      reasonCode: 'evidence_confirmation_required',
    },
    secondaryInsights: [],
    narrative: {
      streamingAvailable: true,
      fallbackText:
        'Minh chứng đã được đọc xong nhưng vẫn cần bạn kiểm tra thông tin. Xác nhận dữ liệu này để lần tiền kiểm tiếp theo phản ánh đúng hồ sơ hiện tại.',
    },
  };
}

describe('student assistant narrative safety', () => {
  it('streams deterministic mock chunks without OpenAI credentials', async () => {
    const chunks: string[] = [];
    const result = await new MockAssistantNarrativeProvider(0).stream(context(), {
      onDelta: (delta) => {
        chunks.push(delta.text);
      },
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(context().narrative.fallbackText);
    expect(result.text).toBe(context().narrative.fallbackText);
  });

  it('falls back when final text claims official approval', () => {
    const fallback = context().narrative.fallbackText;
    expect(validateFinalNarrative('AI xác nhận bạn chắc chắn đạt Sinh viên 5 tốt.', fallback)).toBe(
      fallback,
    );
  });

  it('falls back for overlong or markdown-like output', () => {
    const fallback = context().narrative.fallbackText;
    expect(validateFinalNarrative('| Cột | Giá trị |', fallback)).toBe(fallback);
    expect(validateFinalNarrative('a'.repeat(500), fallback)).toBe(fallback);
  });
});

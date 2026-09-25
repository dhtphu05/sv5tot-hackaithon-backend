import { describe, expect, it } from 'vitest';
import {
  executeStudentAssistantReadOnlyTool,
  selectStudentNavigationAction,
} from '../../src/modules/student-assistant/student-assistant-tools';
import type { StudentAssistantContext } from '../../src/modules/student-assistant/student-assistant.types';
import { ErrorCodes } from '../../src/shared/errors/error-codes';

const baseContext: StudentAssistantContext = {
  contextType: 'evidence_card',
  contextId: 'evidence-1',
  contextVersion: 'version-1',
  generatedAt: '2026-07-21T12:00:00.000Z',
  title: 'Trợ lý minh chứng',
  deterministicSummary: 'Minh chứng cần xác nhận.',
  facts: [
    { id: 'field-1', type: 'evidence_field', label: 'Tên hoạt động', value: 'Mua he xanh', verified: false },
    { id: 'precheck-1', type: 'evidence_precheck', label: 'Tiền kiểm', value: 'Cần xác nhận', verified: true },
  ],
  warnings: [],
  primaryAction: {
    id: 'confirm:evidence-1',
    type: 'confirm_evidence',
    label: 'Xác nhận thông tin',
    destination: { route: '/app/application', query: { evidenceId: 'evidence-1', mode: 'confirm' } },
    allowed: true,
  },
  allowedActions: [
    {
      id: 'confirm:evidence-1',
      type: 'confirm_evidence',
      label: 'Xác nhận thông tin',
      destination: { route: '/app/application', query: { evidenceId: 'evidence-1', mode: 'confirm' } },
      allowed: true,
    },
    {
      id: 'submit:app-1',
      type: 'submit_application',
      label: 'Nộp hồ sơ',
      destination: { route: '/app/application', query: { action: 'submit' } },
      allowed: false,
      disabledReason: 'Chưa đủ điều kiện.',
    },
  ],
  suggestedQuestions: [],
  boundaries: {
    canAnswerAboutCriteria: false,
    canAnswerAboutEvidence: true,
    canAnswerAboutEvents: false,
    canAnswerAboutSupplement: false,
    requiresOfficerForOfficialDecision: true,
  },
};

describe('student assistant tools', () => {
  it('returns only evidence precheck facts for the evidence precheck read tool', () => {
    const result = executeStudentAssistantReadOnlyTool(baseContext, 'get_evidence_precheck_context');

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]?.type).toBe('evidence_precheck');
    expect(result.actions.map((action) => action.id)).toEqual(['confirm:evidence-1']);
  });

  it('selects only backend-allowed navigation actions', () => {
    expect(selectStudentNavigationAction(baseContext, 'confirm:evidence-1').action?.type).toBe(
      'confirm_evidence',
    );

    expect(() => selectStudentNavigationAction(baseContext, 'submit:app-1')).toThrowError(
      expect.objectContaining({ code: ErrorCodes.STUDENT_ASSISTANT_OUT_OF_SCOPE }),
    );
    expect(() => selectStudentNavigationAction(baseContext, 'made-up')).toThrowError(
      expect.objectContaining({ code: ErrorCodes.STUDENT_ASSISTANT_OUT_OF_SCOPE }),
    );
  });
});

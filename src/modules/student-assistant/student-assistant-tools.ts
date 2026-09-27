import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type {
  StudentAssistantAction,
  StudentAssistantContext,
  StudentAssistantContextType,
  StudentAssistantFact,
} from './student-assistant.types';

export type StudentAssistantReadOnlyToolName =
  | 'get_dashboard_context'
  | 'get_application_context'
  | 'get_evidence_context'
  | 'get_evidence_precheck_context'
  | 'get_precheck_context'
  | 'get_criterion_context'
  | 'get_event_context'
  | 'get_supplement_context'
  | 'get_active_criteria'
  | 'evaluate_my_application'
  | 'compare_criteria_levels';

export const studentAssistantReadOnlyToolNames: readonly StudentAssistantReadOnlyToolName[] = [
  'get_dashboard_context',
  'get_application_context',
  'get_evidence_context',
  'get_evidence_precheck_context',
  'get_precheck_context',
  'get_criterion_context',
  'get_event_context',
  'get_supplement_context',
  'get_active_criteria',
  'evaluate_my_application',
  'compare_criteria_levels',
] as const;

export type StudentAssistantToolResult = {
  contextType: StudentAssistantContextType;
  contextId: string;
  title: string;
  summary: string;
  facts: StudentAssistantFact[];
  warnings: StudentAssistantContext['warnings'];
  actions: StudentAssistantAction[];
};

export function executeStudentAssistantReadOnlyTool(
  context: StudentAssistantContext,
  toolName: StudentAssistantReadOnlyToolName,
): StudentAssistantToolResult {
  assertToolAllowedForContext(context, toolName);
  return {
    contextType: context.contextType,
    contextId: context.contextId,
    title: context.title,
    summary: context.deterministicSummary,
    facts: filterFactsForTool(context, toolName),
    warnings: context.warnings,
    actions: context.allowedActions.filter((action) => action.allowed),
  };
}

export function selectStudentNavigationAction(
  context: StudentAssistantContext,
  actionId?: string | null,
): { selectedActionId: string | null; action: StudentAssistantAction | null } {
  const allowedActions = context.allowedActions.filter((action) => action.allowed);
  if (!actionId) {
    const action = context.primaryAction?.allowed ? context.primaryAction : allowedActions[0] ?? null;
    return { selectedActionId: action?.id ?? null, action };
  }
  const action = allowedActions.find((candidate) => candidate.id === actionId);
  if (!action) {
    throw new AppError(
      400,
      ErrorCodes.STUDENT_ASSISTANT_OUT_OF_SCOPE,
      'Navigation action is not available in this assistant context',
    );
  }
  return { selectedActionId: action.id, action };
}

function assertToolAllowedForContext(
  context: StudentAssistantContext,
  toolName: StudentAssistantReadOnlyToolName,
) {
  if (toolName === 'get_dashboard_context' || toolName === 'get_application_context') return;
  if (toolName === 'get_evidence_context' && context.boundaries.canAnswerAboutEvidence) return;
  if (toolName === 'get_evidence_precheck_context' && context.boundaries.canAnswerAboutEvidence) return;
  if (toolName === 'get_precheck_context' && context.boundaries.canAnswerAboutCriteria) return;
  if (toolName === 'get_criterion_context' && context.boundaries.canAnswerAboutCriteria) return;
  if (toolName === 'get_active_criteria' && context.boundaries.canAnswerAboutCriteria) return;
  if (toolName === 'evaluate_my_application' && context.boundaries.canAnswerAboutCriteria) return;
  if (toolName === 'compare_criteria_levels' && context.boundaries.canAnswerAboutCriteria) return;
  if (toolName === 'get_event_context' && context.boundaries.canAnswerAboutEvents) return;
  if (toolName === 'get_supplement_context' && context.boundaries.canAnswerAboutSupplement) return;
  throw new AppError(
    400,
    ErrorCodes.STUDENT_ASSISTANT_OUT_OF_SCOPE,
    'Requested assistant context is outside the current workflow scope',
  );
}

function filterFactsForTool(
  context: StudentAssistantContext,
  toolName: StudentAssistantReadOnlyToolName,
) {
  if (toolName === 'get_evidence_precheck_context') {
    return context.facts.filter(
      (fact) => fact.type === 'evidence_precheck' || fact.type === 'evidence_warning',
    );
  }
  if (toolName === 'get_precheck_context' || toolName === 'get_criterion_context') {
    return context.facts.filter(
      (fact) => fact.type === 'precheck_result' || fact.type === 'criteria_rule',
    );
  }
  if (
    toolName === 'get_active_criteria' ||
    toolName === 'evaluate_my_application' ||
    toolName === 'compare_criteria_levels'
  ) {
    return context.facts.filter(
      (fact) =>
        fact.type === 'criteria_rule' ||
        fact.type === 'criteria_source' ||
        fact.type === 'criteria_gap' ||
        fact.type === 'precheck_result',
    );
  }
  if (toolName === 'get_event_context') {
    return context.facts.filter(
      (fact) => fact.type === 'event_registry' || fact.type === 'participant_status',
    );
  }
  if (toolName === 'get_supplement_context') {
    return context.facts.filter(
      (fact) =>
        fact.type === 'officer_request' ||
        fact.type === 'deadline' ||
        fact.type === 'supplement_progress',
    );
  }
  return context.facts;
}

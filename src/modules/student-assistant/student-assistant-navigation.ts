import type { StudentAssistantAction, StudentAssistantContext } from './student-assistant.types';

export type StudentAssistantNavigation = {
  selectedActionId: string | null;
  action: StudentAssistantAction | null;
};

export function resolveStudentAssistantNavigation(
  context: Pick<StudentAssistantContext, 'allowedActions' | 'primaryAction'>,
  suggestedActionId?: string | null,
): StudentAssistantNavigation {
  const allowed = context.allowedActions.filter((action) => action.allowed);
  const bySuggestion = suggestedActionId
    ? allowed.find((action) => action.id === suggestedActionId)
    : null;
  const byPrimary = context.primaryAction?.allowed ? context.primaryAction : null;
  const action = bySuggestion ?? byPrimary ?? allowed[0] ?? null;
  return {
    selectedActionId: action?.id ?? null,
    action,
  };
}

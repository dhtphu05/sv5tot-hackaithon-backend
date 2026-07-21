import type { Criterion } from '@prisma/client';

export type StudentAssistantContextType =
  'dashboard' | 'evidence_card' | 'precheck' | 'event_registry' | 'supplement';

export type StudentAssistantFactType =
  | 'workflow_state'
  | 'evidence_field'
  | 'evidence_warning'
  | 'precheck_result'
  | 'criteria_rule'
  | 'next_action'
  | 'event_registry'
  | 'participant_status'
  | 'officer_request'
  | 'deadline'
  | 'supplement_progress';

export type StudentAssistantDestination = {
  route: string;
  query?: Record<string, string>;
};

export type StudentAssistantFact = {
  id: string;
  type: StudentAssistantFactType;
  label: string;
  value: string;
  sourceId?: string;
  destination?: StudentAssistantDestination;
  verified: boolean;
};

export type StudentAssistantAction = {
  id: string;
  type:
    | 'open_evidence'
    | 'confirm_evidence'
    | 'correct_evidence'
    | 'replace_file'
    | 'retry_analysis'
    | 'add_evidence'
    | 'open_event'
    | 'check_participant'
    | 'import_event'
    | 'run_precheck'
    | 'rerun_precheck'
    | 'resolve_precheck_issue'
    | 'open_supplement'
    | 'resubmit_supplement'
    | 'submit_application'
    | 'contact_officer';
  label: string;
  description?: string;
  destination: StudentAssistantDestination;
  allowed: boolean;
  disabledReason?: string;
};

export type StudentAssistantWarning = {
  code: string;
  severity: 'info' | 'warning' | 'blocking';
  message: string;
  sourceId?: string;
};

export type StudentAssistantContext = {
  contextType: StudentAssistantContextType;
  contextId: string;
  contextVersion: string;
  generatedAt: string;
  title: string;
  deterministicSummary: string;
  facts: StudentAssistantFact[];
  warnings: StudentAssistantWarning[];
  primaryAction: StudentAssistantAction | null;
  allowedActions: StudentAssistantAction[];
  suggestedQuestions: string[];
  boundaries: {
    canAnswerAboutCriteria: boolean;
    canAnswerAboutEvidence: boolean;
    canAnswerAboutEvents: boolean;
    canAnswerAboutSupplement: boolean;
    requiresOfficerForOfficialDecision: boolean;
  };
};

export type StudentAssistantAnswerIntent =
  | 'explain_state'
  | 'explain_warning'
  | 'explain_evidence'
  | 'explain_precheck'
  | 'explain_next_action'
  | 'explain_event'
  | 'explain_supplement'
  | 'explain_deadline'
  | 'explain_progress'
  | 'needs_officer_clarification'
  | 'out_of_scope';

export type StudentAssistantAnswer = {
  answer: string;
  intent: StudentAssistantAnswerIntent;
  sourceRefs: Array<{
    factId: string;
    label: string;
    destination?: StudentAssistantDestination;
  }>;
  suggestedActionId?: string;
  requiresOfficerClarification: boolean;
};

export type StudentAssistantRecentMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type StudentAssistantContextQuery = {
  contextType: StudentAssistantContextType;
  contextId?: string;
  applicationId?: string;
  criterion?: Criterion;
  evidenceId?: string;
  eventId?: string;
  reviewTaskId?: string;
  schoolYear?: string;
};

export type StudentAssistantStreamInput = StudentAssistantContextQuery & {
  contextVersion: string;
  message: string;
  recentMessages?: StudentAssistantRecentMessage[];
};

export type StudentAssistantStreamCallbacks = {
  onMeta: (data: {
    requestId: string;
    contextType: StudentAssistantContextType;
    contextId: string;
    contextVersion: string;
  }) => void | Promise<void>;
  onStatus: (data: { stage: 'preparing_answer' }) => void | Promise<void>;
  onDelta: (data: { text: string }) => void | Promise<void>;
  onSources: (data: { sourceRefs: StudentAssistantAnswer['sourceRefs'] }) => void | Promise<void>;
  onAction: (data: { suggestedActionId: string | null }) => void | Promise<void>;
  onComplete: (data: StudentAssistantAnswer & { contextVersion: string }) => void | Promise<void>;
  onError: (data: { code: string; recoverable: boolean }) => void | Promise<void>;
};

import type { Criterion, Level } from '@prisma/client';

export type StudentAssistantContextType =
  'dashboard' | 'evidence_card' | 'precheck' | 'event_registry' | 'supplement' | 'criteria';

export type StudentAssistantFactType =
  | 'workflow_state'
  | 'evidence_field'
  | 'evidence_precheck'
  | 'evidence_warning'
  | 'precheck_result'
  | 'criteria_rule'
  | 'criteria_source'
  | 'criteria_gap'
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
    | 'open_application'
    | 'open_evidence'
    | 'confirm_evidence'
    | 'correct_evidence'
    | 'replace_evidence_file'
    | 'retry_evidence_analysis'
    | 'open_precheck'
    | 'open_criterion'
    | 'view_source_criteria'
    | 'open_supplement'
    | 'start_application'
    | 'replace_file'
    | 'retry_analysis'
    | 'add_evidence'
    | 'open_event'
    | 'check_participant'
    | 'import_event'
    | 'run_precheck'
    | 'rerun_precheck'
    | 'resolve_precheck_issue'
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
  | 'explain_level'
  | 'explain_criterion'
  | 'explain_gap'
  | 'compare_levels'
  | 'explain_evidence_relevance'
  | 'explain_source'
  | 'needs_officer_clarification'
  | 'out_of_scope';

export type StudentAssistantAnswer = {
  answer: string;
  finalText?: string;
  intent: StudentAssistantAnswerIntent;
  sourceRefs: Array<{
    factId: string;
    label: string;
    destination?: StudentAssistantDestination;
  }>;
  suggestedActionId?: string;
  navigation?: StudentAssistantAction | null;
  fallback?: boolean;
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
  scope?: Level;
};

export type StudentAssistantStreamInput = StudentAssistantContextQuery & {
  contextVersion: string;
  message: string;
  clientConversationId?: string;
  clientTurnId?: string;
  clientAttemptId?: string;
  recentMessages?: StudentAssistantRecentMessage[];
};

export type StudentAssistantStreamCallbacks = {
  onMeta: (data: {
    requestId: string;
    contextType: StudentAssistantContextType;
    contextId: string;
    contextVersion: string;
    sequence?: number;
  }) => void | Promise<void>;
  onStatus: (data: { stage: 'preparing_context' | 'refreshing_evidence' | 'preparing_answer'; message?: string; requestId?: string; sequence?: number }) => void | Promise<void>;
  onDelta: (data: { text: string; requestId?: string; sequence?: number }) => void | Promise<void>;
  onSources: (data: { sourceRefs: StudentAssistantAnswer['sourceRefs']; requestId?: string; sequence?: number }) => void | Promise<void>;
  onAction: (data: { suggestedActionId: string | null; requestId?: string; sequence?: number }) => void | Promise<void>;
  onNavigation: (data: { selectedActionId: string | null; action: StudentAssistantAction | null; requestId?: string; sequence?: number }) => void | Promise<void>;
  onComplete: (data: StudentAssistantAnswer & { contextVersion: string; finalText: string; fallback?: boolean; requestId?: string; sequence?: number }) => void | Promise<void>;
  onError: (data: { code: string; recoverable: boolean; message?: string; requestId?: string; sequence?: number }) => void | Promise<void>;
};

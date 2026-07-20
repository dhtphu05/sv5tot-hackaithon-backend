import type { Criterion, Level } from '@prisma/client';

export type StudentAssistantState =
  | 'new_user'
  | 'draft_in_progress'
  | 'processing_evidence'
  | 'evidence_confirmation_required'
  | 'needs_attention'
  | 'ready_to_submit'
  | 'supplement_required'
  | 'under_review'
  | 'completed';

export type AssistantActionType =
  | 'start_application'
  | 'continue_application'
  | 'resolve_supplement'
  | 'confirm_evidence'
  | 'retry_evidence_analysis'
  | 'replace_evidence_file'
  | 'resolve_precheck_issue'
  | 'add_evidence'
  | 'run_precheck'
  | 'rerun_precheck'
  | 'submit_application'
  | 'view_review_status'
  | 'view_result'
  | 'none';

export type AssistantDestination = {
  route: string;
  query?: Record<string, string>;
};

export type StudentNextBestAction = {
  id: string;
  type: AssistantActionType;
  priority: number;
  title: string;
  deterministicDescription: string;
  ctaLabel: string;
  destination: AssistantDestination;
  applicationId: string;
  criterion?: Criterion;
  evidenceId?: string;
  reviewTaskId?: string;
  notificationId?: string;
  dueAt?: string;
  urgency?: 'normal' | 'important' | 'urgent';
  reasonCode: string;
};

export type CriterionAssistantSummary = {
  criterion: Criterion;
  status:
    | 'ready'
    | 'missing'
    | 'processing'
    | 'needs_confirmation'
    | 'needs_attention'
    | 'under_review';
  label: string;
};

export type StudentAssistantContext = {
  contextVersion: string;
  generatedAt: string;
  state: StudentAssistantState;
  greeting: {
    title: string;
    deterministicMessage: string;
  };
  application: {
    id: string | null;
    status: string;
    targetLevel: Level | null;
    readinessScore: number | null;
    precheckIsStale: boolean;
  };
  criterionSummary: CriterionAssistantSummary[];
  nextBestAction: StudentNextBestAction | null;
  secondaryInsights: Array<{
    id: string;
    type: string;
    title: string;
    destination?: AssistantDestination;
  }>;
  narrative: {
    streamingAvailable: boolean;
    fallbackText: string;
    streamEndpoint?: string;
    cacheKey?: string;
  };
};

export type AssistantStreamEventCallbacks = {
  onMeta: (data: { contextVersion: string; requestId: string; cached: boolean }) => void | Promise<void>;
  onStatus: (data: { stage: 'preparing_explanation' }) => void | Promise<void>;
  onDelta: (data: { text: string }) => void | Promise<void>;
  onComplete: (data: { text: string; contextVersion: string }) => void | Promise<void>;
  onError: (data: { code: string; recoverable: boolean }) => void | Promise<void>;
};

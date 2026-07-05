import type { Criterion, Level, Role } from '@prisma/client';

export type ChatbotContextScope =
  | 'student_helpdesk'
  | 'reviewer_copilot'
  | 'manager_assistant'
  | 'committee_assistant';

export type ChatbotPage =
  | 'dashboard'
  | 'evidence'
  | 'precheck'
  | 'matching_hub'
  | 'chatbot'
  | 'cascade'
  | 'review_task'
  | 'manager_dashboard'
  | 'resolution_hub';

export type ChatbotPageContext = {
  page?: ChatbotPage;
  criterion?: Criterion;
  evidenceId?: string;
  taskId?: string;
  resolutionCaseId?: string;
};

export type SafeChatbotContext = {
  role: Role;
  contextScope: ChatbotContextScope;
  currentPage?: ChatbotPage;
  targetLevel?: Level;
  applicationStatus?: string;
  criterion?: Criterion;
  missingSummary?: string;
  deadlineSummary?: string;
  nextAction?: string;
  taskSummary?: string;
};

export type SmartbotButton = {
  id: string;
  label: string;
  type: 'navigate' | 'postback' | 'execute';
  actionType?: 'postback' | 'web_url' | 'phone_number' | 'internal_action';
  toolName?: string;
  payload?: string;
  route?: string;
  url?: string;
  phoneNumber?: string;
  query?: Record<string, string>;
  requiredRole?: Role;
  requiresConfirmation: boolean;
};

export type NormalizedSmartbotMessage = {
  type:
    | 'text'
    | 'quickreply'
    | 'image'
    | 'carousel'
    | 'handoff'
    | 'action_cards'
    | 'gap_item'
    | 'evidence_summary'
    | 'matching_event'
    | 'reviewer_draft'
    | 'unknown';
  text?: string;
  title?: string;
  subtitle?: string;
  status?: string;
  description?: string;
  url?: string;
  items?: NormalizedSmartbotMessage[];
  buttons?: SmartbotButton[];
};

export type ChatbotAction = SmartbotButton;

export type NormalizedSmartbotResponse = {
  sessionId: string;
  answer: string;
  messages: NormalizedSmartbotMessage[];
  cards: NormalizedSmartbotMessage[];
  actions: ChatbotAction[];
  suggestedQuestions: string[];
  handoffRequired: boolean;
  smartbot: {
    intentName?: string;
    status?: number;
    rawType: string;
  };
};

export type SmartbotConversationRequest = {
  bot_id: string;
  sender_id: string;
  text: string;
  input_channel: string;
  session_id: string;
  metadata: {
    button_variables: Array<{ variableName: string; value: string }>;
  };
  settings?: {
    system_prompt?: string;
    advance_prompt?: string;
  };
};

export interface SmartbotClient {
  sendMessage(input: SmartbotConversationRequest): Promise<unknown>;
}

export type SmartbotStreamCallbacks = {
  onDelta?: (text: string) => Promise<void> | void;
  onCard?: (response: NormalizedSmartbotResponse) => Promise<void> | void;
  onFinal?: (response: NormalizedSmartbotResponse) => Promise<void> | void;
};

export interface SmartbotStreamClient {
  streamMessage(
    input: SmartbotConversationRequest,
    callbacks: SmartbotStreamCallbacks,
  ): Promise<NormalizedSmartbotResponse>;
}

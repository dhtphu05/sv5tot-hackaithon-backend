import type { Criterion } from '@prisma/client';
import type { ChatbotAction, NormalizedSmartbotMessage, NormalizedSmartbotResponse, SafeChatbotContext } from '../chatbot.types';

export type ChatbotLlmIntentName =
  | 'get_gap_analysis'
  | 'get_evidence_summary'
  | 'search_matching_hub'
  | 'open_evidence_upload'
  | 'create_handoff'
  | 'criteria_rag'
  | 'unknown';

export type ChatbotLlmToolName =
  | 'getGapAnalysis'
  | 'getEvidenceSummary'
  | 'searchMatchingHub'
  | 'openEvidenceUpload'
  | 'createHandoff'
  | 'callVnptRag';

export type ChatbotLlmIntent = {
  intent: ChatbotLlmIntentName;
  confidence: 'high' | 'medium' | 'low';
  tool: ChatbotLlmToolName | null;
  args: {
    criterion: Criterion | null;
    targetLevel: 'school';
  };
  needsHuman: boolean;
  reason: string;
};

export type ChatbotLlmIntentInput = {
  text: string;
  context: SafeChatbotContext;
  availableTools: ChatbotLlmToolName[];
};

export type ChatbotLlmResponseCard = {
  type: 'gap_item' | 'matching_event' | 'evidence_item' | 'handoff' | 'summary';
  title: string;
  status: string;
  description: string;
};

export type ChatbotLlmResponseAction = {
  label: string;
  type: 'navigate' | 'postback' | 'execute';
  route: string | null;
  payload: Record<string, unknown>;
  requiresConfirmation: boolean;
};

export type ChatbotLlmStructuredResponse = {
  answer: string;
  title: string;
  cards: ChatbotLlmResponseCard[];
  actions: ChatbotLlmResponseAction[];
  guardrailNote: string;
};

export type ChatbotLlmResponseInput = {
  text: string;
  context: SafeChatbotContext;
  response: NormalizedSmartbotResponse;
};

export type ChatbotLlmStreamAnswerInput = {
  text: string;
  context: SafeChatbotContext;
  answer: string;
  cards: NormalizedSmartbotMessage[];
  actions: ChatbotAction[];
};

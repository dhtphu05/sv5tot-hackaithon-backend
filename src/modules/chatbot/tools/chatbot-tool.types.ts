import type { ZodSchema } from 'zod';

export type ChatbotToolMode =
  | 'read'
  | 'navigate'
  | 'draft'
  | 'mutation_requires_confirm'
  | 'handoff';

export type ChatbotToolRole = 'student' | 'officer' | 'manager' | 'committee' | 'admin';

export type ChatbotToolDefinition = {
  name: string;
  description: string;
  mode: ChatbotToolMode;
  requiredRoles: ChatbotToolRole[];
  inputSchema: ZodSchema;
  handler: (ctx: ChatbotToolContext, input: unknown) => Promise<ChatbotToolResult>;
};

export type ChatbotToolContext = {
  userId: string;
  role: ChatbotToolRole;
  studentCode?: string;
  sessionId: string;
  applicationId?: string;
  pageContext?: unknown;
  requestId: string;
};

export type ChatbotToolResult = {
  type: 'text' | 'card' | 'cards' | 'draft' | 'navigation' | 'handoff';
  message: string;
  cards?: unknown[];
  actions?: unknown[];
  dataRefs?: Array<{
    type:
      | 'application'
      | 'evidence'
      | 'event'
      | 'review_task'
      | 'resolution_case'
      | 'knowledge_base_item';
    id: string;
  }>;
  safeMetadata?: Record<string, string>;
};

import { Prisma, type Role } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import type { ChatbotAction, NormalizedSmartbotResponse } from './chatbot.types';

export type ChatbotConversationRecord = {
  sessionId: string;
  userId: string;
  workspaceId?: string | null;
  role: Role;
  applicationId?: string;
  reviewTaskId?: string;
  resolutionCaseId?: string;
  contextScope?: string;
};

export interface ChatbotConversationRepository {
  ensureSession(input: ChatbotConversationRecord): Promise<void>;
  saveMessage(input: {
    sessionId: string;
    userId: string;
    userText: string;
    response: NormalizedSmartbotResponse;
  }): Promise<void>;
}

export interface ChatbotActionRepository {
  saveActions(input: {
    sessionId: string;
    userId: string;
    actions: ChatbotAction[];
    workspaceId?: string | null;
  }): Promise<ChatbotAction[]>;
  findAction(actionId: string): Promise<PersistedChatbotAction | null>;
  updateStatus(
    actionId: string,
    status: 'confirmed' | 'executed' | 'cancelled' | 'failed',
  ): Promise<PersistedChatbotAction>;
}

export interface ChatbotHandoffRepository {
  createHandoff(input: {
    sessionId: string;
    userId: string;
    applicationId?: string;
    reviewTaskId?: string;
    resolutionCaseId?: string;
    workspaceId?: string | null;
    reason: string;
  }): Promise<void>;
}

export type PersistedChatbotAction = {
  id: string;
  workspaceId: string | null;
  sessionId: string;
  userId: string;
  actionType: string;
  toolName: string | null;
  label: string;
  route: string | null;
  queryJson: unknown;
  payloadJson: unknown;
  requiredRole: string | null;
  requiresConfirmation: boolean;
  status: string;
  expiresAt: Date;
  confirmedAt: Date | null;
  executedAt: Date | null;
  sessionStatus: string;
  applicationId: string | null;
  reviewTaskId: string | null;
  resolutionCaseId: string | null;
};

const actionTtlMs = 30 * 60 * 1000;

export class PrismaChatbotConversationRepository implements ChatbotConversationRepository {
  async ensureSession(input: ChatbotConversationRecord): Promise<void> {
    await prisma.chatSession.upsert({
      where: { id: input.sessionId },
      create: {
        id: input.sessionId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        role: input.role,
        applicationId: input.applicationId,
        reviewTaskId: input.reviewTaskId,
        resolutionCaseId: input.resolutionCaseId,
        providerSessionId: input.sessionId,
        contextScope: input.contextScope,
      },
      update: {
        status: 'active',
        workspaceId: input.workspaceId,
        contextScope: input.contextScope,
        applicationId: input.applicationId,
        reviewTaskId: input.reviewTaskId,
        resolutionCaseId: input.resolutionCaseId,
      },
    });
  }

  async saveMessage(input: {
    sessionId: string;
    userId: string;
    userText: string;
    response: NormalizedSmartbotResponse;
  }): Promise<void> {
    await prisma.chatMessage.createMany({
      data: [
        {
          sessionId: input.sessionId,
          sender: 'user',
          textRedacted: input.userText.slice(0, 2000),
        },
        {
          sessionId: input.sessionId,
          sender: 'bot',
          textRedacted: input.response.answer.slice(0, 4000),
          normalizedPayloadJson: toJson(input.response),
          providerStatus: input.response.smartbot.status,
          metadataJson: toJson(input.response.smartbot),
        },
      ],
    });
  }
}

export class PrismaChatbotActionRepository implements ChatbotActionRepository {
  async saveActions(input: {
    sessionId: string;
    userId: string;
    workspaceId?: string | null;
    actions: ChatbotAction[];
  }): Promise<ChatbotAction[]> {
    const saved: ChatbotAction[] = [];
    for (const action of input.actions) {
      const created = await prisma.chatbotAction.create({
        data: {
          sessionId: input.sessionId,
          workspaceId: input.workspaceId,
          userId: input.userId,
          actionType: action.type,
          toolName: action.toolName,
          label: action.label,
          route: action.route,
          queryJson: toJson(action.query),
          payloadJson: toJson({
            payload: action.payload,
            url: action.url,
            phoneNumber: action.phoneNumber,
            actionType: action.actionType,
          }),
          requiredRole: action.requiredRole,
          requiresConfirmation: action.requiresConfirmation,
          expiresAt: new Date(Date.now() + actionTtlMs),
        },
      });
      saved.push({ ...action, id: created.id });
    }
    return saved;
  }

  async findAction(actionId: string): Promise<PersistedChatbotAction | null> {
    const action = await prisma.chatbotAction.findUnique({
      where: { id: actionId },
      include: {
        session: {
          select: {
            status: true,
            workspaceId: true,
            applicationId: true,
            reviewTaskId: true,
            resolutionCaseId: true,
          },
        },
      },
    });
    return action ? toPersistedAction(action) : null;
  }

  async updateStatus(
    actionId: string,
    status: 'confirmed' | 'executed' | 'cancelled' | 'failed',
  ): Promise<PersistedChatbotAction> {
    const now = new Date();
    const action = await prisma.chatbotAction.update({
      where: { id: actionId },
      include: {
        session: {
          select: {
            status: true,
            workspaceId: true,
            applicationId: true,
            reviewTaskId: true,
            resolutionCaseId: true,
          },
        },
      },
      data: {
        status,
        confirmedAt: status === 'confirmed' ? now : undefined,
        executedAt: status === 'executed' ? now : undefined,
      },
    });
    return toPersistedAction(action);
  }
}

export class PrismaChatbotHandoffRepository implements ChatbotHandoffRepository {
  async createHandoff(input: {
    sessionId: string;
    userId: string;
    applicationId?: string;
    reviewTaskId?: string;
    resolutionCaseId?: string;
    workspaceId?: string | null;
    reason: string;
  }): Promise<void> {
    await prisma.chatbotHandoff.create({
      data: {
        sessionId: input.sessionId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        applicationId: input.applicationId,
        reviewTaskId: input.reviewTaskId,
        resolutionCaseId: input.resolutionCaseId,
        reason: input.reason,
      },
    });
  }
}

export class NoopChatbotConversationRepository implements ChatbotConversationRepository {
  async ensureSession(): Promise<void> {
    return undefined;
  }

  async saveMessage(): Promise<void> {
    return undefined;
  }
}

export class NoopChatbotActionRepository implements ChatbotActionRepository {
  async saveActions(input: {
    sessionId: string;
    userId: string;
    actions: ChatbotAction[];
  }): Promise<ChatbotAction[]> {
    return input.actions;
  }

  async findAction(): Promise<PersistedChatbotAction | null> {
    return null;
  }

  async updateStatus(): Promise<PersistedChatbotAction> {
    throw new Error('Noop action repository cannot update action state');
  }
}

export class NoopChatbotHandoffRepository implements ChatbotHandoffRepository {
  async createHandoff(): Promise<void> {
    return undefined;
  }
}

function toJson(value: unknown): Prisma.InputJsonValue {
  if (value === undefined) return {};
  return value as Prisma.InputJsonValue;
}

function toPersistedAction(
  action: Prisma.ChatbotActionGetPayload<{
    include: {
      session: {
        select: {
          status: true;
          workspaceId: true;
          applicationId: true;
          reviewTaskId: true;
          resolutionCaseId: true;
        };
      };
    };
  }>,
): PersistedChatbotAction {
  return {
    ...action,
    sessionStatus: action.session.status,
    workspaceId: action.workspaceId ?? action.session.workspaceId,
    applicationId: action.session.applicationId,
    reviewTaskId: action.session.reviewTaskId,
    resolutionCaseId: action.session.resolutionCaseId,
  };
}

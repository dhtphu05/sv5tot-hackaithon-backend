import type { Role } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { auditActions } from '../../shared/constants/application';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import {
  PrismaChatbotActionRepository,
  type ChatbotActionRepository,
  type PersistedChatbotAction,
} from './chatbot.repository';

export class ChatbotActionService {
  constructor(
    private readonly actionRepository: ChatbotActionRepository = new PrismaChatbotActionRepository(),
  ) {}

  async confirm(user: AuthenticatedUser, actionId: string) {
    const action = await this.getUsableAction(user, actionId, ['pending']);
    if (!action.requiresConfirmation) {
      return { action: toActionResponse(action), message: 'Hành động này không cần xác nhận.' };
    }
    const updated = await this.actionRepository.updateStatus(actionId, 'confirmed');
    await auditAction(user, updated, auditActions.CHATBOT_ACTION_CONFIRMED);
    return { action: toActionResponse(updated), message: 'Đã xác nhận hành động.' };
  }

  async execute(user: AuthenticatedUser, actionId: string) {
    const action = await this.getUsableAction(user, actionId, ['pending', 'confirmed']);
    if (action.requiresConfirmation && action.status !== 'confirmed') {
      throw new AppError(
        409,
        ErrorCodes.CHATBOT_ACTION_INVALID_STATE,
        'Action must be confirmed before execution',
      );
    }

    if (action.actionType === 'navigate') {
      const updated = await this.actionRepository.updateStatus(actionId, 'executed');
      await auditAction(user, updated, auditActions.CHATBOT_ACTION_EXECUTED);
      return {
        action: toActionResponse(updated),
        result: {
          type: 'navigation',
          route: action.route,
          query: action.queryJson,
          message: 'Mở màn hình liên quan.',
        },
      };
    }

    if (action.actionType === 'postback') {
      const updated = await this.actionRepository.updateStatus(actionId, 'executed');
      await auditAction(user, updated, auditActions.CHATBOT_ACTION_EXECUTED);
      return {
        action: toActionResponse(updated),
        result: {
          type: 'postback',
          payload: action.payloadJson,
          message: 'Gửi nội dung này về luồng chat để xử lý tiếp.',
        },
      };
    }

    if (action.actionType === 'execute' || action.toolName === 'createSchoolDemoHandoff') {
      if (action.toolName === 'createSchoolDemoHandoff') {
        const updated = await this.actionRepository.updateStatus(actionId, 'executed');
        await auditAction(user, updated, auditActions.CHATBOT_ACTION_EXECUTED);
        return {
          action: toActionResponse(updated),
          result: {
            type: 'postback',
            payload: { payload: 'Hỏi cán bộ phụ trách' },
            message: 'Tạo yêu cầu hỗ trợ cán bộ trong luồng chat.',
          },
        };
      }
      if (
        action.toolName === 'addSchoolDemoEvidence' ||
        action.toolName === 'submitSchoolDemoEvidence' ||
        action.toolName === 'useSupplementDraft'
      ) {
        const updated = await this.actionRepository.updateStatus(actionId, 'executed');
        await auditAction(user, updated, auditActions.CHATBOT_ACTION_EXECUTED);
        return {
          action: toActionResponse(updated),
          result: {
            type: 'message',
            message: 'Hành động này sẽ được bật sau khi có xác nhận nghiệp vụ.',
          },
        };
      }
    }

    throw new AppError(
      409,
      ErrorCodes.MUTATION_ACTION_NOT_ENABLED,
      'Hành động này cần luồng xác nhận nghiệp vụ riêng và chưa được bật trong MVP.',
    );
  }

  async cancel(user: AuthenticatedUser, actionId: string) {
    await this.getUsableAction(user, actionId, ['pending', 'confirmed']);
    const updated = await this.actionRepository.updateStatus(actionId, 'cancelled');
    await auditAction(user, updated, auditActions.CHATBOT_ACTION_CANCELLED);
    return { action: toActionResponse(updated), message: 'Đã hủy hành động.' };
  }

  private async getUsableAction(
    user: AuthenticatedUser,
    actionId: string,
    allowedStatuses: string[],
  ): Promise<PersistedChatbotAction> {
    const action = await this.actionRepository.findAction(actionId);
    if (!action) {
      throw new AppError(404, ErrorCodes.CHATBOT_ACTION_NOT_FOUND, 'Chatbot action not found');
    }
    if (action.userId !== user.id) {
      throw new AppError(403, ErrorCodes.CHATBOT_ACTION_FORBIDDEN, 'Action belongs to another user');
    }
    if (action.sessionStatus !== 'active') {
      throw new AppError(409, ErrorCodes.CHATBOT_ACTION_INVALID_STATE, 'Chat session is not active');
    }
    if (action.expiresAt.getTime() <= Date.now()) {
      await this.actionRepository.updateStatus(actionId, 'failed').catch(() => undefined);
      throw new AppError(409, ErrorCodes.CHATBOT_ACTION_EXPIRED, 'Chatbot action has expired');
    }
    if (action.requiredRole && action.requiredRole !== user.role) {
      throw new AppError(403, ErrorCodes.CHATBOT_ACTION_FORBIDDEN, 'Role cannot execute this action');
    }
    if (!allowedStatuses.includes(action.status)) {
      throw new AppError(
        409,
        ErrorCodes.CHATBOT_ACTION_INVALID_STATE,
        'Chatbot action is not in an executable state',
      );
    }
    return action;
  }
}

async function auditAction(
  user: AuthenticatedUser,
  action: PersistedChatbotAction,
  auditActionName: string,
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      actorRole: user.role,
      action: auditActionName,
      targetType: 'chatbot_action',
      targetId: action.id,
      applicationId: action.applicationId,
      evidenceId: null,
      afterStateJson: {
        status: action.status,
        actionType: action.actionType,
        route: action.route,
        toolName: action.toolName,
      },
      metadataJson: {
        sessionId: action.sessionId,
        reviewTaskId: action.reviewTaskId,
        resolutionCaseId: action.resolutionCaseId,
      },
    },
  });
}

function toActionResponse(action: PersistedChatbotAction) {
  return {
    id: action.id,
    label: action.label,
    type: action.actionType,
    toolName: action.toolName,
    route: action.route,
    query: action.queryJson,
    payload: action.payloadJson,
    requiredRole: action.requiredRole as Role | null,
    requiresConfirmation: action.requiresConfirmation,
    status: action.status,
    expiresAt: action.expiresAt,
  };
}

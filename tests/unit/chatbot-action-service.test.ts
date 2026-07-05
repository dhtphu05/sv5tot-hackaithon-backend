import { Role } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ChatbotActionRepository,
  PersistedChatbotAction,
} from '../../src/modules/chatbot/chatbot.repository';
import type { AuthenticatedUser } from '../../src/shared/types/auth';
import { ErrorCodes } from '../../src/shared/errors/error-codes';

const prismaMock = vi.hoisted(() => ({
  auditLog: { create: vi.fn() },
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({
  prisma: prismaMock,
}));

import { ChatbotActionService } from '../../src/modules/chatbot/chatbot-action.service';

const user: AuthenticatedUser = {
  id: '2e2031e8-bd75-4d93-9b7a-78a8f31f4e22',
  email: 'student@example.com',
  role: Role.student,
  fullName: 'Student',
  studentCode: null,
  className: null,
  faculty: null,
  avatarUrl: null,
};

describe('ChatbotActionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.auditLog.create.mockResolvedValue({});
  });

  it('confirmation-gates and audits confirmable actions', async () => {
    const repo = fakeRepository({
      ...baseAction(),
      actionType: 'navigate',
      requiresConfirmation: true,
      status: 'pending',
    });
    const service = new ChatbotActionService(repo);

    await expect(service.execute(user, 'action-1')).rejects.toMatchObject({
      code: ErrorCodes.CHATBOT_ACTION_INVALID_STATE,
    });

    const confirmed = await service.confirm(user, 'action-1');

    expect(confirmed.action.status).toBe('confirmed');
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'CHATBOT_ACTION_CONFIRMED',
          targetType: 'chatbot_action',
          targetId: 'action-1',
        }),
      }),
    );
  });

  it('blocks mutation actions in the MVP execution path', async () => {
    const repo = fakeRepository({ ...baseAction(), actionType: 'mutation', status: 'confirmed' });
    const service = new ChatbotActionService(repo);

    await expect(service.execute(user, 'action-1')).rejects.toMatchObject({
      code: ErrorCodes.MUTATION_ACTION_NOT_ENABLED,
    });
  });
});

function fakeRepository(initial: PersistedChatbotAction): ChatbotActionRepository {
  let action = initial;
  return {
    saveActions: vi.fn(),
    findAction: vi.fn(async () => action),
    updateStatus: vi.fn(async (_actionId, status) => {
      action = {
        ...action,
        status,
        confirmedAt: status === 'confirmed' ? new Date() : action.confirmedAt,
        executedAt: status === 'executed' ? new Date() : action.executedAt,
      };
      return action;
    }),
  };
}

function baseAction(): PersistedChatbotAction {
  return {
    id: 'action-1',
    sessionId: '5f3f86d3-3028-4e29-9220-7f09d7a8ab05',
    userId: user.id,
    actionType: 'navigate',
    toolName: null,
    label: 'Mở hồ sơ',
    route: '/app/drafts',
    queryJson: {},
    payloadJson: {},
    requiredRole: Role.student,
    requiresConfirmation: false,
    status: 'pending',
    expiresAt: new Date(Date.now() + 60_000),
    confirmedAt: null,
    executedAt: null,
    sessionStatus: 'active',
    applicationId: null,
    reviewTaskId: null,
    resolutionCaseId: null,
  };
}

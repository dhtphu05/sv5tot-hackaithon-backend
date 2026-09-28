import {
  ApplicationStatus,
  ApplicationType,
  FinalStatus,
  Level,
  Role,
  WorkspaceType,
} from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../src/shared/types/auth';

const mocks = vi.hoisted(() => ({
  application: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({ prisma: mocks }));

const cityWorkspace = {
  id: 'city-workspace',
  code: 'DANANG_CITY',
  name: 'Da Nang',
  shortName: 'Da Nang',
  type: WorkspaceType.CITY,
};

const finalizedApplication = {
  id: 'application-1',
  workspaceId: 'school-a',
  workspace: { type: WorkspaceType.SCHOOL, isActive: true },
  studentId: 'student-1',
  applicationType: ApplicationType.individual,
  targetLevel: Level.city,
  status: ApplicationStatus.completed,
  finalStatus: FinalStatus.passed,
  finalLevel: Level.city,
  finalNote: 'Final note',
  finalizedAt: new Date('2026-09-25T00:00:00.000Z'),
  finalizedById: 'committee-1',
  cancelledAt: null,
};

function user(role: Role): AuthenticatedUser {
  return {
    id: `${role}-1`,
    email: `${role}@example.test`,
    fullName: role,
    role,
    workspaceId: 'city-workspace',
    workspace: cityWorkspace,
    studentCode: null,
    className: null,
    faculty: null,
    avatarUrl: null,
  };
}

describe('ManagerService.reopenFinal history', () => {
  let tx: {
    $queryRaw: ReturnType<typeof vi.fn>;
    application: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    applicationFinalDecisionHistory: { create: ReturnType<typeof vi.fn> };
    auditLog: { create: ReturnType<typeof vi.fn> };
    notification: { create: ReturnType<typeof vi.fn> };
  };
  let current: typeof finalizedApplication;

  beforeEach(() => {
    vi.clearAllMocks();
    current = { ...finalizedApplication };
    tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: current.id, cancelledAt: null }]),
      application: {
        findUnique: vi.fn().mockImplementation(async () => current),
        update: vi.fn().mockImplementation(async ({ data }) => {
          current = { ...current, ...data };
          return current;
        }),
      },
      applicationFinalDecisionHistory: {
        create: vi.fn().mockResolvedValue({ id: 'history-1' }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
      notification: { create: vi.fn().mockResolvedValue({ id: 'notification-1' }) },
    };
    mocks.application.findUnique.mockImplementation(async () => ({ ...finalizedApplication }));
    mocks.$transaction.mockImplementation(async (callback: (value: unknown) => unknown) =>
      callback(tx),
    );
  });

  it.each([Role.city_manager, Role.city_committee, Role.admin])(
    'preserves the current final for the existing %s role and resets current fields',
    async (role) => {
      const { ManagerService } = await import('../../src/modules/manager/manager.service');
      const service = new ManagerService();

      await service.reopenFinal(user(role), 'application-1', {
        reason: 'Appeal accepted',
        status: ApplicationStatus.under_review,
      });

      expect(tx.applicationFinalDecisionHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          applicationId: 'application-1',
          finalStatus: FinalStatus.passed,
          finalLevel: Level.city,
          finalNote: 'Final note',
          finalizedAt: finalizedApplication.finalizedAt,
          finalizedById: 'committee-1',
          supersededAt: expect.any(Date),
          supersededById: `${role}-1`,
          supersedeReason: 'Appeal accepted',
        }),
      });
      expect(tx.application.update).toHaveBeenCalledWith({
        where: { id: 'application-1' },
        data: expect.objectContaining({
          status: ApplicationStatus.under_review,
          finalStatus: FinalStatus.pending,
          finalLevel: null,
          finalNote: null,
          finalizedAt: null,
          finalizedById: null,
        }),
      });
      expect(tx.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'FINAL_DECISION_SUPERSEDED',
          targetId: 'application-1',
          note: 'Appeal accepted',
        }),
      });
    },
  );

  it('records history only once when a concurrent/repeated reopen reaches the locked row', async () => {
    const { ManagerService } = await import('../../src/modules/manager/manager.service');
    const service = new ManagerService();

    await service.reopenFinal(user(Role.city_manager), 'application-1', {
      reason: 'Appeal accepted',
      status: ApplicationStatus.under_review,
    });
    await service.reopenFinal(user(Role.city_manager), 'application-1', {
      reason: 'Repeated request',
      status: ApplicationStatus.under_review,
    });

    expect(tx.applicationFinalDecisionHistory.create).toHaveBeenCalledTimes(1);
    expect(tx.application.update).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(2);
    expect(tx.notification.create).toHaveBeenCalledTimes(1);
  });

  it('does not let reopen-final bypass a cancellation', async () => {
    const { ManagerService } = await import('../../src/modules/manager/manager.service');
    tx.$queryRaw.mockResolvedValue([{ id: 'application-1', cancelledAt: new Date() }]);
    const service = new ManagerService();

    await expect(
      service.reopenFinal(user(Role.city_manager), 'application-1', {
        reason: 'Appeal accepted',
        status: ApplicationStatus.under_review,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'APPLICATION_CANCELLED',
      message: 'Hồ sơ đã bị hủy. Mở lại hồ sơ trước khi tiếp tục xử lý.',
    });
    expect(tx.applicationFinalDecisionHistory.create).not.toHaveBeenCalled();
    expect(tx.application.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
  });
});

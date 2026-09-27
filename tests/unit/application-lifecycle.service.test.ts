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

async function lifecycleService() {
  const module = await import('../../src/modules/applications/application-lifecycle.service').catch(
    () => null,
  );
  expect(module).not.toBeNull();
  if (!module) return null;
  return new module.ApplicationLifecycleService();
}

async function lifecycleSchemas() {
  const module = await import('../../src/modules/manager/manager.validation');
  const schemas = module as unknown as Record<
    string,
    { safeParse: (value: unknown) => { success: boolean } } | undefined
  >;
  for (const name of [
    'cancelApplicationSchema',
    'reopenCancelledApplicationSchema',
    'archiveApplicationSchema',
    'unarchiveApplicationSchema',
  ]) {
    expect(schemas[name], `expected ${name}`).toBeDefined();
  }
  return schemas;
}

const schoolWorkspace = { type: WorkspaceType.SCHOOL, isActive: true };
const cityManager: AuthenticatedUser = {
  id: 'city-manager',
  email: 'manager@city.test',
  fullName: 'City Manager',
  role: Role.city_manager,
  workspaceId: 'city-workspace',
  workspace: {
    id: 'city-workspace',
    code: 'DANANG_CITY',
    name: 'Da Nang',
    shortName: 'Da Nang',
    type: WorkspaceType.CITY,
  },
  studentCode: null,
  className: null,
  faculty: null,
  avatarUrl: null,
};

type LifecycleTransactionMock = {
  $queryRaw: ReturnType<typeof vi.fn>;
  application: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  applicationFinalDecisionHistory: {
    create: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  };
  reviewTask: { findFirst: ReturnType<typeof vi.fn> };
  supplementRequest: { findFirst: ReturnType<typeof vi.fn> };
  auditLog: { create: ReturnType<typeof vi.fn> };
  notification: { create: ReturnType<typeof vi.fn> };
};

function application(overrides: Record<string, unknown> = {}) {
  return {
    id: 'application-1',
    workspaceId: 'school-a',
    workspace: schoolWorkspace,
    studentId: 'student-1',
    applicationType: ApplicationType.individual,
    targetLevel: Level.city,
    schoolYear: '2026-2027',
    status: ApplicationStatus.under_review,
    submittedAt: new Date('2026-09-20T00:00:00.000Z'),
    finalStatus: FinalStatus.pending,
    finalLevel: null,
    finalNote: null,
    finalizedAt: null,
    finalizedById: null,
    cancelledAt: null,
    cancelledById: null,
    cancelReason: null,
    archivedAt: null,
    archivedById: null,
    archiveReason: null,
    ...overrides,
  };
}

describe('ApplicationLifecycleService', () => {
  let tx: LifecycleTransactionMock;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'application-1', cancelledAt: null }]),
      application: {
        findUnique: vi.fn().mockImplementation(async () => application()),
        update: vi.fn().mockImplementation(async ({ data }) => application(data)),
      },
      applicationFinalDecisionHistory: {
        create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'history-1', ...data })),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      reviewTask: { findFirst: vi.fn().mockResolvedValue(null) },
      supplementRequest: { findFirst: vi.fn().mockResolvedValue(null) },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
      notification: { create: vi.fn().mockResolvedValue({ id: 'notification-1' }) },
    };
    mocks.application.findUnique.mockResolvedValue(application());
    mocks.$transaction.mockImplementation(async (callback: (value: unknown) => unknown) => callback(tx));
  });

  it('requires non-blank reasons and accepts only an empty unarchive body', async () => {
    const schemas = await lifecycleSchemas();
    expect(schemas.cancelApplicationSchema?.safeParse({ reason: '  ' }).success).toBe(false);
    expect(schemas.reopenCancelledApplicationSchema?.safeParse({ reason: '' }).success).toBe(false);
    expect(schemas.archiveApplicationSchema?.safeParse({}).success).toBe(true);
    expect(schemas.unarchiveApplicationSchema?.safeParse({}).success).toBe(true);
    expect(schemas.unarchiveApplicationSchema?.safeParse({ reason: 'unexpected' }).success).toBe(false);
  });

  it('denies non-lifecycle roles before loading an application', async () => {
    const service = await lifecycleService();
    if (!service) return;
    await expect(
      service.cancel(
        { ...cityManager, role: Role.city_committee },
        'application-1',
        { reason: 'Duplicate submission' },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.application.findUnique).not.toHaveBeenCalled();
  });

  it('does not cancel an unsubmitted draft or a non-City application', async () => {
    const service = await lifecycleService();
    if (!service) return;
    const draft = application({ status: ApplicationStatus.draft, submittedAt: null });
    tx.application.findUnique.mockResolvedValue(draft);
    mocks.application.findUnique.mockResolvedValueOnce(
      draft,
    );
    await expect(
      service.cancel(cityManager, 'application-1', {
        reason: 'Duplicate submission',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    mocks.application.findUnique.mockResolvedValueOnce(application({ targetLevel: Level.school }));
    await expect(
      service.cancel(cityManager, 'application-1', {
        reason: 'Duplicate submission',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(tx.application.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('cancels a submitted application without changing its workflow status or retained data', async () => {
    const service = await lifecycleService();
    if (!service) return;
    await service.cancel(cityManager, 'application-1', {
      reason: 'Duplicate submission',
    });

    expect(tx.application.update).toHaveBeenCalledWith({
      where: { id: 'application-1' },
      data: expect.objectContaining({
        cancelledById: cityManager.id,
        cancelReason: 'Duplicate submission',
        cancelledAt: expect.any(Date),
      }),
    });
    expect(tx.applicationFinalDecisionHistory.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'APPLICATION_CANCELLED' }) }),
    );
    expect(tx.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'student-1',
          message: expect.stringContaining('Duplicate submission'),
        }),
      }),
    );
  });

  it('allows admin lifecycle access to an active School City application', async () => {
    const service = await lifecycleService();
    if (!service) return;
    const admin = { ...cityManager, role: Role.admin, workspaceId: null };

    await service.cancel(admin, 'application-1', { reason: 'Duplicate submission' });

    expect(tx.application.update).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ actorRole: Role.admin }) }),
    );
  });

  it('returns a conflict for a repeated cancellation without duplicate side effects', async () => {
    const service = await lifecycleService();
    if (!service) return;
    tx.application.findUnique.mockResolvedValue(
      application({ cancelledAt: new Date('2026-09-26T00:00:00.000Z') }),
    );

    await expect(
      service.cancel(cityManager, 'application-1', { reason: 'Duplicate submission' }),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(tx.application.update).not.toHaveBeenCalled();
    expect(tx.applicationFinalDecisionHistory.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
  });

  it('snapshots and clears a current final atomically when cancelling', async () => {
    const service = await lifecycleService();
    if (!service) return;
    const finalized = application({
      status: ApplicationStatus.completed,
      finalStatus: FinalStatus.passed,
      finalLevel: Level.city,
      finalNote: 'Awarded',
      finalizedAt: new Date('2026-09-25T00:00:00.000Z'),
      finalizedById: 'committee-1',
    });
    tx.application.findUnique.mockResolvedValue(finalized);
    tx.application.update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({ ...finalized, ...data }),
    );

    await service.cancel(cityManager, 'application-1', {
      reason: 'Decision correction',
    });

    expect(tx.applicationFinalDecisionHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        applicationId: 'application-1',
        finalStatus: FinalStatus.passed,
        finalLevel: Level.city,
        finalNote: 'Awarded',
        finalizedById: 'committee-1',
        supersededById: cityManager.id,
        supersedeReason: 'Decision correction',
      }),
    });
    expect(tx.application.update).toHaveBeenCalledWith({
      where: { id: 'application-1' },
      data: expect.objectContaining({
        finalStatus: FinalStatus.pending,
        finalLevel: null,
        finalNote: null,
        finalizedAt: null,
        finalizedById: null,
      }),
    });
    expect(tx.application.update.mock.calls[0][0].data).not.toHaveProperty('status');
    expect(tx.auditLog.create).toHaveBeenCalledTimes(2);
  });

  it('reopens a cancelled final without restoring history and auto-unarchives', async () => {
    const service = await lifecycleService();
    if (!service) return;
    const cancelled = application({
      status: ApplicationStatus.completed,
      cancelledAt: new Date('2026-09-26T00:00:00.000Z'),
      cancelledById: cityManager.id,
      cancelReason: 'Decision correction',
      archivedAt: new Date('2026-09-27T00:00:00.000Z'),
      archiveReason: 'Closed season',
    });
    tx.application.findUnique.mockResolvedValue(cancelled);
    tx.application.update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({ ...cancelled, ...data }),
    );
    tx.applicationFinalDecisionHistory.findFirst.mockResolvedValue({ id: 'history-1' });

    await service.reopenCancelled(cityManager, 'application-1', {
      reason: 'Appeal accepted',
    });

    expect(tx.application.update).toHaveBeenCalledWith({
      where: { id: 'application-1' },
      data: expect.objectContaining({
        status: ApplicationStatus.under_review,
        cancelledAt: null,
        cancelledById: null,
        cancelReason: null,
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
      }),
    });
    expect(tx.applicationFinalDecisionHistory.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledTimes(2);
    expect(tx.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ message: 'Hồ sơ của bạn đã được mở lại để tiếp tục xét duyệt.' }),
      }),
    );
  });

  it('reopens a superseded final to supplement_required only when a retained supplement is active', async () => {
    const service = await lifecycleService();
    if (!service) return;
    tx.application.findUnique.mockResolvedValue(
      application({ status: ApplicationStatus.rejected, cancelledAt: new Date() }),
    );
    tx.applicationFinalDecisionHistory.findFirst.mockResolvedValue({ id: 'history-1' });
    tx.reviewTask.findFirst.mockResolvedValue({ id: 'task-1' });

    await service.reopenCancelled(cityManager, 'application-1', {
      reason: 'Supplement requested',
    });

    expect(tx.application.update).toHaveBeenCalledWith({
      where: { id: 'application-1' },
      data: expect.objectContaining({ status: ApplicationStatus.supplement_required }),
    });
  });

  it('rejects archive for active workflow and archives only terminal applications', async () => {
    const service = await lifecycleService();
    if (!service) return;
    await expect(
      service.archive(cityManager, 'application-1', {}),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.application.update).not.toHaveBeenCalled();

    tx.application.findUnique.mockResolvedValue(
      application({ status: ApplicationStatus.completed, finalStatus: FinalStatus.passed }),
    );
    tx.application.update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => application(data),
    );
    await service.archive(cityManager, 'application-1', {
      reason: 'Season closed',
    });

    expect(tx.application.update).toHaveBeenCalledWith({
      where: { id: 'application-1' },
      data: expect.objectContaining({ archivedById: cityManager.id, archiveReason: 'Season closed' }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'APPLICATION_ARCHIVED' }) }),
    );
  });

  it('unarchives without changing cancellation or workflow state', async () => {
    const service = await lifecycleService();
    if (!service) return;
    tx.application.findUnique.mockResolvedValue(
      application({ cancelledAt: new Date(), archivedAt: new Date(), status: ApplicationStatus.under_review }),
    );
    tx.application.update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => application(data),
    );

    await service.unarchive(cityManager, 'application-1');

    expect(tx.application.update).toHaveBeenCalledWith({
      where: { id: 'application-1' },
      data: { archivedAt: null, archivedById: null, archiveReason: null },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'APPLICATION_UNARCHIVED' }) }),
    );
  });
});

import { ApplicationStatus, Role } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspacesService } from '../../src/modules/workspaces/workspaces.service';

const now = new Date('2026-07-17T00:00:00.000Z');
const workspaceId = '11111111-1111-4111-8111-111111111111';
const actor = {
  id: 'admin-1',
  workspaceId: null,
  email: 'admin@example.test',
  role: Role.admin,
  fullName: 'Admin',
  studentCode: null,
  className: null,
  faculty: null,
  avatarUrl: null,
  workspace: null,
};

function workspace(overrides: Record<string, unknown> = {}) {
  return {
    id: workspaceId,
    code: 'TEST-DHDN',
    name: 'Test Workspace',
    shortName: 'TEST',
    isActive: true,
    registrationEnabled: false,
    createdAt: now,
    updatedAt: now,
    _count: { users: 2, applications: 1 },
    ...overrides,
  };
}

function buildMocks() {
  const repository = {
    list: vi.fn(),
    listAdmin: vi.fn(),
    findById: vi.fn(),
    findByCode: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    countUsersByRole: vi.fn(),
    countApplicationsByStatus: vi.fn(),
    findLatestActiveCriteria: vi.fn(),
    countActiveCriteria: vi.fn(),
    countRole: vi.fn(),
    listWorkspaceUsers: vi.fn(),
  };
  const auditService = { log: vi.fn().mockResolvedValue(undefined) };
  const service = new WorkspacesService(repository as never, auditService as never);
  return { repository, auditService, service };
}

describe('admin workspace service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a workspace with defaults and audit', async () => {
    const { repository, auditService, service } = buildMocks();
    repository.findByCode.mockResolvedValue(null);
    repository.create.mockResolvedValue(workspace({ registrationEnabled: false }));

    const result = await service.createAdmin(actor, {
      code: ' test-dhdn ',
      name: ' Test Workspace ',
      shortName: ' TEST ',
    });

    expect(repository.create).toHaveBeenCalledWith({
      code: 'TEST-DHDN',
      name: 'Test Workspace',
      shortName: 'TEST',
      isActive: true,
      registrationEnabled: false,
    });
    expect(result).toMatchObject({ code: 'TEST-DHDN', userCount: 2, applicationCount: 1 });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: actor.id,
        actorRole: Role.admin,
        workspaceId,
        action: 'WORKSPACE_CREATED',
        entityType: 'workspace',
      }),
    );
  });

  it('blocks duplicate workspace code', async () => {
    const { repository, service } = buildMocks();
    repository.findByCode.mockResolvedValue({ id: 'existing' });

    await expect(
      service.createAdmin(actor, { code: 'TEST-DHDN', name: 'Duplicate' }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'WORKSPACE_CODE_ALREADY_EXISTS' });
  });

  it('blocks invalid workspace code', async () => {
    const { service } = buildMocks();

    await expect(
      service.createAdmin(actor, { code: 'bad code', name: 'Invalid' }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'WORKSPACE_CODE_INVALID' });
  });

  it('blocks opening registration while creating an inactive workspace', async () => {
    const { service } = buildMocks();

    await expect(
      service.createAdmin(actor, {
        code: 'NEW-DHDN',
        name: 'Inactive',
        isActive: false,
        registrationEnabled: true,
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'WORKSPACE_STATUS_INVALID' });
  });

  it('updates editable workspace fields only and audits before and after state', async () => {
    const { repository, auditService, service } = buildMocks();
    const before = workspace({ name: 'Old Name', shortName: 'OLD' });
    const after = workspace({ name: 'New Name', shortName: 'NEW' });
    repository.findById.mockResolvedValue(before);
    repository.update.mockResolvedValue(after);

    const result = await service.updateAdmin(actor, workspaceId, {
      name: ' New Name ',
      shortName: ' NEW ',
      code: 'OTHER-CODE',
    } as never);

    expect(repository.update).toHaveBeenCalledWith(workspaceId, {
      name: 'New Name',
      shortName: 'NEW',
    });
    expect(result).toMatchObject({ name: 'New Name', shortName: 'NEW' });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WORKSPACE_UPDATED',
        before,
        after,
      }),
    );
  });

  it('does not open registration without active criteria', async () => {
    const { repository, service } = buildMocks();
    repository.findById.mockResolvedValue(workspace({ registrationEnabled: false }));
    repository.countActiveCriteria.mockResolvedValue(0);
    repository.countRole.mockResolvedValue(1);

    await expect(
      service.updateStatusAdmin(actor, workspaceId, { registrationEnabled: true }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'WORKSPACE_NOT_READY_FOR_REGISTRATION',
    });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('does not enable registration while deactivating a workspace', async () => {
    const { repository, service } = buildMocks();
    repository.findById.mockResolvedValue(
      workspace({ isActive: true, registrationEnabled: false }),
    );

    await expect(
      service.updateStatusAdmin(actor, workspaceId, {
        isActive: false,
        registrationEnabled: true,
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'WORKSPACE_STATUS_INVALID' });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('opens registration when active criteria exists and audits it', async () => {
    const { repository, auditService, service } = buildMocks();
    repository.findById.mockResolvedValue(workspace({ registrationEnabled: false }));
    repository.countActiveCriteria.mockResolvedValue(1);
    repository.countRole.mockResolvedValue(1);
    repository.update.mockResolvedValue(workspace({ registrationEnabled: true }));

    const result = await service.updateStatusAdmin(actor, workspaceId, {
      registrationEnabled: true,
    });

    expect(repository.update).toHaveBeenCalledWith(workspaceId, {
      isActive: true,
      registrationEnabled: true,
    });
    expect(result.readiness.readyForRegistration).toBe(true);
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WORKSPACE_REGISTRATION_OPENED' }),
    );
  });

  it('deactivates a workspace, closes registration, and audits both changes', async () => {
    const { repository, auditService, service } = buildMocks();
    repository.findById.mockResolvedValue(workspace({ isActive: true, registrationEnabled: true }));
    repository.update.mockResolvedValue(
      workspace({
        isActive: false,
        registrationEnabled: false,
        _count: { users: 4, applications: 3 },
      }),
    );
    repository.countActiveCriteria.mockResolvedValue(1);
    repository.countRole.mockResolvedValue(1);

    const result = await service.updateStatusAdmin(actor, workspaceId, { isActive: false });

    expect(repository.update).toHaveBeenCalledWith(workspaceId, {
      isActive: false,
      registrationEnabled: false,
    });
    expect(result).toMatchObject({
      isActive: false,
      registrationEnabled: false,
      userCount: 4,
      applicationCount: 3,
    });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WORKSPACE_DEACTIVATED' }),
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WORKSPACE_REGISTRATION_CLOSED' }),
    );
  });

  it('closes registration without deleting users or applications', async () => {
    const { repository, auditService, service } = buildMocks();
    repository.findById.mockResolvedValue(workspace({ registrationEnabled: true }));
    repository.update.mockResolvedValue(
      workspace({ registrationEnabled: false, _count: { users: 8, applications: 5 } }),
    );
    repository.countActiveCriteria.mockResolvedValue(1);
    repository.countRole.mockResolvedValue(1);

    const result = await service.updateStatusAdmin(actor, workspaceId, {
      registrationEnabled: false,
    });

    expect(result).toMatchObject({ registrationEnabled: false, userCount: 8, applicationCount: 5 });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WORKSPACE_REGISTRATION_CLOSED' }),
    );
  });

  it('reactivates a workspace without automatically opening registration', async () => {
    const { repository, auditService, service } = buildMocks();
    repository.findById.mockResolvedValue(
      workspace({ isActive: false, registrationEnabled: false }),
    );
    repository.update.mockResolvedValue(workspace({ isActive: true, registrationEnabled: false }));
    repository.countActiveCriteria.mockResolvedValue(1);
    repository.countRole.mockResolvedValue(1);

    const result = await service.updateStatusAdmin(actor, workspaceId, { isActive: true });

    expect(repository.update).toHaveBeenCalledWith(workspaceId, {
      isActive: true,
      registrationEnabled: false,
    });
    expect(result).toMatchObject({ isActive: true, registrationEnabled: false });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WORKSPACE_ACTIVATED' }),
    );
    expect(auditService.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WORKSPACE_REGISTRATION_OPENED' }),
    );
  });

  it('lists users only from the target workspace', async () => {
    const { repository, service } = buildMocks();
    repository.findById.mockResolvedValue(workspace());
    repository.listWorkspaceUsers.mockResolvedValue({
      items: [
        {
          id: 'user-a',
          fullName: 'User A',
          email: 'a@example.test',
          role: Role.student,
          studentCode: 'SV001',
          faculty: 'CNTT',
          className: '22T',
          isActive: true,
          createdAt: now,
        },
      ],
      total: 1,
    });

    const result = await service.listAdminWorkspaceUsers(workspaceId, {
      search: 'SV001',
      role: Role.student,
      isActive: true,
      page: 2,
      limit: 10,
    });

    expect(repository.listWorkspaceUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        skip: 10,
        take: 10,
        where: expect.objectContaining({ role: Role.student, isActive: true }),
      }),
    );
    expect(result.pagination).toEqual({ page: 2, limit: 10, total: 1, totalPages: 1 });
  });

  it('applies workspace search, filters, and pagination', async () => {
    const { repository, service } = buildMocks();
    repository.listAdmin.mockResolvedValue({ items: [workspace()], total: 21 });

    const result = await service.listAdmin({
      search: 'dh',
      isActive: true,
      registrationEnabled: false,
      page: 2,
      limit: 20,
    });

    expect(repository.listAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 20,
        take: 20,
        where: expect.objectContaining({
          isActive: true,
          registrationEnabled: false,
          OR: expect.any(Array),
        }),
      }),
    );
    expect(result.pagination).toEqual({ page: 2, limit: 20, total: 21, totalPages: 2 });
  });

  it('returns detail readiness with warnings separate from blockers', async () => {
    const { repository, service } = buildMocks();
    repository.findById.mockResolvedValue(workspace());
    repository.countUsersByRole.mockResolvedValue([{ role: Role.student, _count: { _all: 3 } }]);
    repository.countApplicationsByStatus.mockResolvedValue([
      { status: ApplicationStatus.submitted, _count: { _all: 2 } },
    ]);
    repository.findLatestActiveCriteria.mockResolvedValue({ id: 'criteria-1' });
    repository.countActiveCriteria.mockResolvedValue(1);
    repository.countRole.mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(0);

    const result = await service.getAdmin(workspaceId);

    expect(result.usersByRole.student).toBe(3);
    expect(result.applicationsByStatus.submitted).toBe(2);
    expect(result.readiness.readyForRegistration).toBe(true);
    expect(result.readiness.blockers).toEqual([]);
    expect(result.readiness.warnings).toEqual([
      'WORKSPACE_MANAGER_MISSING',
      'WORKSPACE_OFFICER_MISSING',
      'WORKSPACE_COMMITTEE_MISSING',
    ]);
  });

  it('public registration list reflects open and closed workspace status', async () => {
    const state = [workspace({ registrationEnabled: false })];
    const repository = {
      list: vi.fn(async (where: { isActive?: boolean; registrationEnabled?: boolean }) =>
        state
          .filter((item) => where.isActive === undefined || item.isActive === where.isActive)
          .filter(
            (item) =>
              where.registrationEnabled === undefined ||
              item.registrationEnabled === where.registrationEnabled,
          ),
      ),
      findById: vi.fn(async () => state[0]),
      update: vi.fn(
        async (_id: string, data: { isActive: boolean; registrationEnabled: boolean }) => {
          Object.assign(state[0], data);
          return state[0];
        },
      ),
      countActiveCriteria: vi.fn().mockResolvedValue(1),
      countRole: vi.fn().mockResolvedValue(1),
    };
    const service = new WorkspacesService(repository as never, { log: vi.fn() } as never);

    await expect(service.list({ registration: true })).resolves.toEqual([]);
    await service.updateStatusAdmin(actor, workspaceId, { registrationEnabled: true });
    await expect(service.list({ registration: true })).resolves.toEqual([
      expect.objectContaining({ id: workspaceId, code: 'TEST-DHDN' }),
    ]);
    await service.updateStatusAdmin(actor, workspaceId, { registrationEnabled: false });
    await expect(service.list({ registration: true })).resolves.toEqual([]);
  });
});

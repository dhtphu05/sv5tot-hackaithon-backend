import { Criterion, Role, WorkspaceType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsersService } from '../../src/modules/users/users.service';
import { PasswordService } from '../../src/modules/auth/password.service';

const admin = { id: 'admin', role: Role.admin, workspaceId: null, email: 'admin@test', fullName: 'Admin' } as never;
const now = new Date('2026-09-29T00:00:00.000Z');
const testCredential = () => ['safe', 'pass', '123'].join('-');

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1', workspaceId: 'school-1', fullName: 'Student', email: 'student@test',
    passwordHash: 'never-return-this', phone: null, role: Role.student, studentCode: '001',
    className: '1A', faculty: null, avatarUrl: null, isActive: true, lastLoginAt: null,
    createdAt: now, updatedAt: now, workspace: { id: 'school-1', code: 'S1', name: 'School', shortName: 'S1' },
    officerSpecializations: [], ...overrides,
  };
}

function setup() {
  const tx = {
    user: {
      findUnique: vi.fn().mockResolvedValue({ id: 'user-1', workspaceId: 'school-1' }),
      update: vi.fn().mockResolvedValue({ id: 'user-1' }),
    },
    refreshToken: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
  };
  const repository = {
    listAdmin: vi.fn(), findAdminById: vi.fn(), findWorkspaceAdmin: vi.fn(), createAdminUser: vi.fn(),
    findAdminByEmail: vi.fn().mockResolvedValue(null),
    updateAdminUser: vi.fn(), setAdminUserActive: vi.fn(), revokeRefreshTokensForUser: vi.fn(),
    hasWorkflowReferences: vi.fn().mockResolvedValue(false), listOfficerSpecializations: vi.fn().mockResolvedValue([]),
    countActiveAssignmentsForCriteria: vi.fn().mockResolvedValue(0), replaceOfficerSpecializations: vi.fn(),
    transaction: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)),
  };
  const storage = {};
  const passwords = { hashPassword: vi.fn().mockResolvedValue('hashed-password') };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const service = new UsersService(repository as never, storage as never, passwords as never, audit as never);
  return { repository, passwords, audit, service, tx };
}

describe('admin user operations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hashes initial credentials, validates SCHOOL pairing, and returns no secret', async () => {
    const { repository, passwords, audit, service } = setup();
    repository.findWorkspaceAdmin.mockResolvedValue({ id: 'school-1', type: WorkspaceType.SCHOOL, isActive: true });
    repository.createAdminUser.mockResolvedValue(user());
    const result = await service.createAdminUser(admin, {
      fullName: 'Student', email: 'STUDENT@test', password: testCredential(), role: Role.student,
      workspaceId: 'school-1', studentCode: '001',
    } as never);
    expect(passwords.hashPassword).toHaveBeenCalledWith(testCredential());
    expect(repository.createAdminUser).toHaveBeenCalledWith(expect.objectContaining({ passwordHash: 'hashed-password', email: 'student@test' }));
    expect(result).not.toHaveProperty('passwordHash');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_CREATED' }));
  });

  it('rejects role and workspace mismatches before creating an account', async () => {
    const { repository, service } = setup();
    repository.findWorkspaceAdmin.mockResolvedValue({ id: 'school-1', type: WorkspaceType.SCHOOL, isActive: true });
    await expect(service.createAdminUser(admin, {
      fullName: 'Officer', email: 'officer@test', password: testCredential(), role: Role.city_officer,
      workspaceId: 'school-1',
    } as never)).rejects.toMatchObject({ statusCode: 400, code: 'USER_WORKSPACE_ROLE_INVALID' });
    expect(repository.createAdminUser).not.toHaveBeenCalled();
  });

  it.each([Role.class_representative, Role.officer, Role.manager, Role.committee])(
    'keeps legacy %s accounts scoped to SCHOOL workspaces', async (role) => {
      const { repository, service } = setup();
      repository.findWorkspaceAdmin.mockResolvedValue({ id: 'city', type: WorkspaceType.CITY, isActive: true });
      await expect(service.createAdminUser(admin, {
        fullName: 'Legacy user', email: 'legacy@test', password: testCredential(), role, workspaceId: 'city',
      } as never)).rejects.toMatchObject({ statusCode: 400, code: 'USER_WORKSPACE_ROLE_INVALID' });
      expect(repository.createAdminUser).not.toHaveBeenCalled();
    },
  );

  it('blocks role or workspace changes for users referenced by workflows', async () => {
    const { repository, service } = setup();
    repository.findAdminById.mockResolvedValue(user());
    repository.findWorkspaceAdmin.mockResolvedValue({ id: 'city', type: WorkspaceType.CITY, isActive: true });
    repository.hasWorkflowReferences.mockResolvedValue(true);
    await expect(service.updateAdminUser(admin, 'user-1', { role: Role.city_officer, workspaceId: 'city' } as never))
      .rejects.toMatchObject({ statusCode: 409, code: 'USER_WORKFLOW_REASSIGNMENT_BLOCKED' });
    expect(repository.updateAdminUser).not.toHaveBeenCalled();
  });

  it('deactivates accounts, revokes refresh tokens, and audits the operation', async () => {
    const { repository, audit, service } = setup();
    repository.findAdminById.mockResolvedValue(user());
    repository.findWorkspaceAdmin.mockResolvedValue({ id: 'school-1', type: WorkspaceType.SCHOOL, isActive: true });
    repository.setAdminUserActive.mockResolvedValue(user({ isActive: false }));
    await service.setAdminUserActive(admin, 'user-1', false);
    expect(repository.setAdminUserActive).toHaveBeenCalledWith('user-1', false);
    expect(repository.revokeRefreshTokensForUser).toHaveBeenCalledWith('user-1');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_DEACTIVATED' }));
  });

  it('resets a password, revokes refresh tokens, and audits inside the same transaction without returning secrets', async () => {
    const { repository, passwords, audit, service, tx } = setup();

    const result = await service.resetAdminUserPassword(admin, 'user-1', testCredential());

    expect(repository.transaction).toHaveBeenCalledOnce();
    expect(passwords.hashPassword).toHaveBeenCalledWith(testCredential());
    expect(tx.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' }, select: { id: true, workspaceId: true } });
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { passwordHash: 'hashed-password' } });
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'admin', actorRole: Role.admin, workspaceId: 'school-1',
      action: 'USER_PASSWORD_RESET', entityType: 'user', entityId: 'user-1', tx,
    }));
    expect(JSON.stringify(audit.log.mock.calls)).not.toContain(testCredential());
    expect(JSON.stringify(audit.log.mock.calls)).not.toContain('hashed-password');
    expect(result).toEqual({ userId: 'user-1' });
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('makes the prior password fail and the replacement password verify after reset', async () => {
    const passwordService = new PasswordService();
    let storedHash = await passwordService.hashPassword('Old-password-123');
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 'user-1', workspaceId: 'school-1' }),
        update: vi.fn(async ({ data }: { data: { passwordHash: string } }) => {
          storedHash = data.passwordHash;
          return { id: 'user-1' };
        }),
      },
      refreshToken: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const repository = { transaction: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)) };
    const audit = { log: vi.fn().mockResolvedValue(undefined) };
    const service = new UsersService(repository as never, {} as never, passwordService, audit as never);

    await service.resetAdminUserPassword(admin, 'user-1', 'Replacement-password-123');

    expect(await passwordService.verifyPassword('Old-password-123', storedHash)).toBe(false);
    expect(await passwordService.verifyPassword('Replacement-password-123', storedHash)).toBe(true);
  });

  it('rejects non-admin callers before hashing or opening a transaction', async () => {
    const { repository, passwords, service } = setup();
    const manager = { id: 'manager', role: Role.manager, workspaceId: 'school-1', email: 'manager@test', fullName: 'Manager' };
    await expect(service.resetAdminUserPassword(manager as never, 'user-1', testCredential()))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(passwords.hashPassword).not.toHaveBeenCalled();
    expect(repository.transaction).not.toHaveBeenCalled();
  });

  it('does not mutate or audit when the target user is missing', async () => {
    const { audit, passwords, service, tx } = setup();
    tx.user.findUnique.mockResolvedValue(null);
    await expect(service.resetAdminUserPassword(admin, 'missing-user', testCredential()))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
    expect(passwords.hashPassword).toHaveBeenCalledOnce();
  });

  it('accepts only the five City criteria for officer specializations', async () => {
    const { repository, service } = setup();
    repository.findAdminById.mockResolvedValue(user({ role: Role.city_officer }));
    repository.findWorkspaceAdmin.mockResolvedValue({ id: 'school-1', type: WorkspaceType.CITY, isActive: true });
    repository.replaceOfficerSpecializations.mockResolvedValue([]);
    await service.setOfficerSpecializations(admin, 'user-1', [Criterion.ethics, Criterion.academic, Criterion.physical, Criterion.volunteer, Criterion.integration]);
    expect(repository.replaceOfficerSpecializations).toHaveBeenCalledWith('user-1', [Criterion.ethics, Criterion.academic, Criterion.physical, Criterion.volunteer, Criterion.integration]);
  });
});

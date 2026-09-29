import { Criterion, Role, WorkspaceType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsersService } from '../../src/modules/users/users.service';

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
  const repository = {
    listAdmin: vi.fn(), findAdminById: vi.fn(), findWorkspaceAdmin: vi.fn(), createAdminUser: vi.fn(),
    findAdminByEmail: vi.fn().mockResolvedValue(null),
    updateAdminUser: vi.fn(), setAdminUserActive: vi.fn(), revokeRefreshTokensForUser: vi.fn(),
    hasWorkflowReferences: vi.fn().mockResolvedValue(false), listOfficerSpecializations: vi.fn().mockResolvedValue([]),
    countActiveAssignmentsForCriteria: vi.fn().mockResolvedValue(0), replaceOfficerSpecializations: vi.fn(),
  };
  const storage = {};
  const passwords = { hashPassword: vi.fn().mockResolvedValue('hashed-password') };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const service = new UsersService(repository as never, storage as never, passwords as never, audit as never);
  return { repository, passwords, audit, service };
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

  it('accepts only the five City criteria for officer specializations', async () => {
    const { repository, service } = setup();
    repository.findAdminById.mockResolvedValue(user({ role: Role.city_officer }));
    repository.findWorkspaceAdmin.mockResolvedValue({ id: 'school-1', type: WorkspaceType.CITY, isActive: true });
    repository.replaceOfficerSpecializations.mockResolvedValue([]);
    await service.setOfficerSpecializations(admin, 'user-1', [Criterion.ethics, Criterion.academic, Criterion.physical, Criterion.volunteer, Criterion.integration]);
    expect(repository.replaceOfficerSpecializations).toHaveBeenCalledWith('user-1', [Criterion.ethics, Criterion.academic, Criterion.physical, Criterion.volunteer, Criterion.integration]);
  });
});

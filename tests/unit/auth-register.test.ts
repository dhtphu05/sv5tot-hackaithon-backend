import { Role, type User, type Workspace } from '@prisma/client';
import { WorkspaceType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../src/modules/auth/auth.service';
import { loginSchema, registerSchema } from '../../src/modules/auth/auth.validation';
import { UsersService } from '../../src/modules/users/users.service';
import { WorkspacesService } from '../../src/modules/workspaces/workspaces.service';
import { sha256 } from '../../src/shared/utils/hash';

const baseWorkspace: Workspace = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'DHBK-DHDN',
  type: WorkspaceType.SCHOOL,
  parentWorkspaceId: null,
  name: 'Trường Đại học Bách khoa - Đại học Đà Nẵng',
  shortName: 'DHBK',
  isActive: true,
  registrationEnabled: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const secondWorkspace: Workspace = {
  ...baseWorkspace,
  id: '22222222-2222-4222-8222-222222222222',
  code: 'PILOT-5TOT',
  registrationEnabled: true,
};

const baseUser: User & { workspace: Workspace } = {
  id: '2e2031e8-bd75-4d93-9b7a-78a8f31f4e22',
  workspaceId: baseWorkspace.id,
  fullName: 'Nguyen Van A',
  email: 'student.new@dut.udn.vn',
  passwordHash: 'hashed-password',
  phone: '0901234567',
  role: Role.student,
  studentCode: '21IT999',
  className: '21TCLC_DT1',
  faculty: 'Cong nghe thong tin',
  avatarUrl: null,
  isActive: true,
  lastLoginAt: new Date('2026-01-01T00:00:00.000Z'),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  workspace: baseWorkspace,
};

const validPassphrase = process.env.SEED_DEFAULT_PASSWORD ?? ['Password', '@123'].join('');

function buildService(overrides: Partial<MockAuthRepository> = {}) {
  const repository: MockAuthRepository = {
    findWorkspaceById: vi.fn().mockResolvedValue(baseWorkspace),
    findUserByEmail: vi.fn().mockResolvedValue(null),
    findUserByStudentCode: vi.fn().mockResolvedValue(null),
    findUserById: vi.fn().mockResolvedValue(baseUser),
    updateLastLogin: vi.fn().mockResolvedValue(baseUser),
    createStudentUser: vi.fn().mockResolvedValue(baseUser),
    createRefreshToken: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
  const passwordService = {
    hashPassword: vi.fn().mockResolvedValue('hashed-password'),
    verifyPassword: vi.fn().mockResolvedValue(true),
  };
  const tokenService = {
    createAccessToken: vi.fn().mockReturnValue('access-token'),
    createRefreshToken: vi.fn().mockReturnValue({
      token: 'refresh-token',
      expiresAt: new Date('2026-01-08T00:00:00.000Z'),
    }),
  };

  return {
    service: new AuthService(repository as never, passwordService as never, tokenService as never),
    repository,
    passwordService,
    tokenService,
  };
}

type MockAuthRepository = {
  findWorkspaceById: ReturnType<typeof vi.fn>;
  findUserByEmail: ReturnType<typeof vi.fn>;
  findUserByStudentCode: ReturnType<typeof vi.fn>;
  findUserById: ReturnType<typeof vi.fn>;
  updateLastLogin: ReturnType<typeof vi.fn>;
  createStudentUser: ReturnType<typeof vi.fn>;
  createRefreshToken: ReturnType<typeof vi.fn>;
};

const registerInput = {
  fullName: 'Nguyen Van A',
  email: 'student.new@dut.udn.vn',
  password: validPassphrase,
  workspaceId: baseWorkspace.id,
  studentCode: '21IT999',
  className: '21TCLC_DT1',
  faculty: 'Cong nghe thong tin',
  phone: '0901234567',
};

describe('AuthService.register', () => {
  it('creates a student account in a workspace and returns login tokens', async () => {
    const { service, repository, passwordService } = buildService();

    const result = await service.register(registerInput, {
      userAgent: 'vitest',
      ipAddress: '127.0.0.1',
    });

    expect(repository.findWorkspaceById).toHaveBeenCalledWith(baseWorkspace.id);
    expect(passwordService.hashPassword).toHaveBeenCalledWith(validPassphrase);
    expect(repository.findUserByStudentCode).toHaveBeenCalledWith(baseWorkspace.id, '21IT999');
    expect(repository.createStudentUser).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: baseWorkspace.id,
        email: 'student.new@dut.udn.vn',
        passwordHash: 'hashed-password',
        studentCode: '21IT999',
      }),
    );
    expect(repository.createRefreshToken).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: baseUser.id,
        tokenHash: sha256('refresh-token'),
        userAgent: 'vitest',
        ipAddress: '127.0.0.1',
      }),
    );
    expect(result).toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: {
        id: baseUser.id,
        email: 'student.new@dut.udn.vn',
        role: Role.student,
        workspaceId: baseWorkspace.id,
        workspace: {
          id: baseWorkspace.id,
          code: 'DHBK-DHDN',
          name: baseWorkspace.name,
          shortName: 'DHBK',
        },
      },
    });
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(result.user).not.toHaveProperty('refreshTokens');
    expect(result.user).not.toHaveProperty('tokenHash');
  });

  it('rejects missing workspaceId through validation expectations', () => {
    const { workspaceId: _workspaceId, ...input } = registerInput;
    expect(() => registerSchema.parse(input)).toThrow();
  });

  it('strips client-supplied role and active status from public registration input', () => {
    const parsed = registerSchema.parse({ ...registerInput, role: Role.admin, isActive: false });
    expect(parsed).not.toHaveProperty('role');
    expect(parsed).not.toHaveProperty('isActive');
  });

  it('enforces the same password maximum on login input', () => {
    expect(() => loginSchema.parse({ email: 'student@example.test', password: 'x'.repeat(129) })).toThrow();
  });

  it('rejects a workspace that does not exist', async () => {
    const { service } = buildService({
      findWorkspaceById: vi.fn().mockResolvedValue(null),
    });

    await expect(service.register(registerInput, {})).rejects.toMatchObject({
      statusCode: 404,
      code: 'WORKSPACE_NOT_FOUND',
    });
  });

  it('rejects an inactive workspace', async () => {
    const { service } = buildService({
      findWorkspaceById: vi.fn().mockResolvedValue({ ...baseWorkspace, isActive: false }),
    });

    await expect(service.register(registerInput, {})).rejects.toMatchObject({
      statusCode: 403,
      code: 'WORKSPACE_INACTIVE',
    });
  });

  it('rejects a workspace closed for registration', async () => {
    const { service } = buildService({
      findWorkspaceById: vi.fn().mockResolvedValue({
        ...baseWorkspace,
        registrationEnabled: false,
      }),
    });

    await expect(service.register(registerInput, {})).rejects.toMatchObject({
      statusCode: 403,
      code: 'WORKSPACE_REGISTRATION_CLOSED',
    });
  });

  it.each([WorkspaceType.CITY, WorkspaceType.UNIVERSITY_SYSTEM])(
    'rejects public student registration for %s workspaces',
    async (type) => {
      const { service, repository } = buildService({
        findWorkspaceById: vi.fn().mockResolvedValue({ ...baseWorkspace, type }),
      });

      await expect(service.register(registerInput, {})).rejects.toMatchObject({
        statusCode: 403,
        code: 'WORKSPACE_REGISTRATION_CLOSED',
      });
      expect(repository.createStudentUser).not.toHaveBeenCalled();
      expect(repository.createRefreshToken).not.toHaveBeenCalled();
    },
  );

  it('rejects an already registered email across workspaces', async () => {
    const { service } = buildService({
      findUserByEmail: vi.fn().mockResolvedValue({ ...baseUser, workspace: secondWorkspace }),
    });

    await expect(
      service.register({ ...registerInput, workspaceId: secondWorkspace.id }, {}),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
      message: 'Email is already registered',
    });
  });

  it('rejects an already registered student code in the same workspace', async () => {
    const { service } = buildService({
      findUserByStudentCode: vi.fn().mockResolvedValue(baseUser),
    });

    await expect(service.register(registerInput, {})).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
      message: 'Student code is already registered',
    });
  });

  it('maps a unique-constraint race to the matching public registration conflict', async () => {
    const { service, repository } = buildService({
      createStudentUser: vi.fn().mockRejectedValue({
        code: 'P2002',
        meta: { target: ['workspaceId', 'studentCode'] },
      }),
    });

    await expect(service.register(registerInput, {})).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
      message: 'Student code is already registered',
    });
    expect(repository.createRefreshToken).not.toHaveBeenCalled();
  });

  it('allows the same student code in a different workspace', async () => {
    const { service, repository } = buildService({
      findWorkspaceById: vi.fn().mockResolvedValue(secondWorkspace),
      createStudentUser: vi.fn().mockResolvedValue({
        ...baseUser,
        workspaceId: secondWorkspace.id,
        workspace: secondWorkspace,
      }),
    });

    const result = await service.register(
      { ...registerInput, email: 'student.other@dut.udn.vn', workspaceId: secondWorkspace.id },
      {},
    );

    expect(repository.findUserByStudentCode).toHaveBeenCalledWith(secondWorkspace.id, '21IT999');
    expect(result.user.workspaceId).toBe(secondWorkspace.id);
  });
});

describe('AuthService.login', () => {
  it('uses the same invalid-credentials response for a wrong password', async () => {
    const { repository } = buildService({
      findUserByEmail: vi.fn().mockResolvedValue(baseUser),
    });
    const passwordService = { verifyPassword: vi.fn().mockResolvedValue(false) };
    const isolatedService = new AuthService(repository as never, passwordService as never, {} as never);

    await expect(
      isolatedService.login({ email: baseUser.email, password: validPassphrase }, {}),
    ).rejects.toMatchObject({ statusCode: 401, code: 'INVALID_CREDENTIALS' });
    expect(repository.updateLastLogin).not.toHaveBeenCalled();
  });

  it('rejects inactive users without creating a session', async () => {
    const { service, repository } = buildService({
      findUserByEmail: vi.fn().mockResolvedValue({ ...baseUser, isActive: false }),
    });

    await expect(
      service.login({ email: baseUser.email, password: validPassphrase }, {}),
    ).rejects.toMatchObject({ statusCode: 403, code: 'USER_INACTIVE' });
    expect(repository.updateLastLogin).not.toHaveBeenCalled();
    expect(repository.createRefreshToken).not.toHaveBeenCalled();
  });

  it('rechecks the account after updating last login before issuing tokens', async () => {
    const { service, repository } = buildService({
      findUserByEmail: vi.fn().mockResolvedValue(baseUser),
      findUserById: vi.fn().mockResolvedValue({ ...baseUser, isActive: false }),
    });

    await expect(
      service.login({ email: baseUser.email, password: validPassphrase }, {}),
    ).rejects.toMatchObject({ statusCode: 403, code: 'USER_INACTIVE' });
    expect(repository.createRefreshToken).not.toHaveBeenCalled();
  });

  it('returns SafeUser with workspace summary', async () => {
    const { service } = buildService({
      findUserByEmail: vi.fn().mockResolvedValue(baseUser),
      findUserById: vi.fn().mockResolvedValue(baseUser),
    });

    const result = await service.login(
      { email: 'student.new@dut.udn.vn', password: validPassphrase },
      {},
    );

    expect(result.user).toMatchObject({
      workspaceId: baseWorkspace.id,
      workspace: {
        id: baseWorkspace.id,
        code: baseWorkspace.code,
        name: baseWorkspace.name,
        shortName: baseWorkspace.shortName,
      },
    });
  });

  it('rejects login for active users whose workspace is inactive', async () => {
    const { service, repository } = buildService({
      findUserByEmail: vi.fn().mockResolvedValue({
        ...baseUser,
        workspace: { ...baseWorkspace, isActive: false },
      }),
    });

    await expect(
      service.login({ email: baseUser.email, password: validPassphrase }, {}),
    ).rejects.toMatchObject({ statusCode: 403, code: 'WORKSPACE_INACTIVE' });
    expect(repository.updateLastLogin).not.toHaveBeenCalled();
    expect(repository.createRefreshToken).not.toHaveBeenCalled();
  });

  it('allows existing students to login when only registration is closed', async () => {
    const closedWorkspace = { ...baseWorkspace, registrationEnabled: false };
    const { service } = buildService({
      findUserByEmail: vi.fn().mockResolvedValue({ ...baseUser, workspace: closedWorkspace }),
      findUserById: vi.fn().mockResolvedValue({ ...baseUser, workspace: closedWorkspace }),
    });

    await expect(
      service.login({ email: baseUser.email, password: validPassphrase }, {}),
    ).resolves.toMatchObject({ user: { role: Role.student } });
  });
});

describe('UsersService.getMe', () => {
  it('returns SafeUser with workspace summary', async () => {
    const usersRepository = {
      findById: vi.fn().mockResolvedValue({ ...baseUser, officerSpecializations: [] }),
    };
    const service = new UsersService(usersRepository as never, {} as never);

    const result = await service.getMe(baseUser.id);

    expect(result).toMatchObject({
      id: baseUser.id,
      workspaceId: baseWorkspace.id,
      workspace: {
        id: baseWorkspace.id,
        code: baseWorkspace.code,
      },
    });
    expect(result).not.toHaveProperty('passwordHash');
    expect(result).not.toHaveProperty('refreshTokens');
  });
});

describe('WorkspacesService.list', () => {
  it('returns only active registration-enabled workspaces when registration=true', async () => {
    const repository = {
      list: vi.fn().mockResolvedValue([baseWorkspace]),
    };
    const service = new WorkspacesService(repository as never);

    const result = await service.list({ registration: true });

    expect(repository.list).toHaveBeenCalledWith({
      isActive: true,
      registrationEnabled: true,
      type: WorkspaceType.SCHOOL,
    });
    expect(result).toEqual([
      {
        id: baseWorkspace.id,
        code: baseWorkspace.code,
        name: baseWorkspace.name,
        shortName: baseWorkspace.shortName,
      },
    ]);
  });
});

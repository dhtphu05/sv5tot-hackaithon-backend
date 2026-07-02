import { Role, type User } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../src/modules/auth/auth.service';

const baseUser: User = {
  id: '2e2031e8-bd75-4d93-9b7a-78a8f31f4e22',
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
};

function buildService(overrides: Partial<MockAuthRepository> = {}) {
  const repository: MockAuthRepository = {
    findUserByEmail: vi.fn().mockResolvedValue(null),
    findUserByStudentCode: vi.fn().mockResolvedValue(null),
    createStudentUser: vi.fn().mockResolvedValue(baseUser),
    createRefreshToken: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
  const passwordService = {
    hashPassword: vi.fn().mockResolvedValue('hashed-password'),
    verifyPassword: vi.fn(),
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
  findUserByEmail: ReturnType<typeof vi.fn>;
  findUserByStudentCode: ReturnType<typeof vi.fn>;
  createStudentUser: ReturnType<typeof vi.fn>;
  createRefreshToken: ReturnType<typeof vi.fn>;
};

describe('AuthService.register', () => {
  it('creates a student account and returns login tokens', async () => {
    const { service, repository, passwordService } = buildService();

    const result = await service.register(
      {
        fullName: 'Nguyen Van A',
        email: 'student.new@dut.udn.vn',
        password: 'Password@123',
        studentCode: '21IT999',
        className: '21TCLC_DT1',
        faculty: 'Cong nghe thong tin',
        phone: '0901234567',
      },
      { userAgent: 'vitest', ipAddress: '127.0.0.1' },
    );

    expect(passwordService.hashPassword).toHaveBeenCalledWith('Password@123');
    expect(repository.createStudentUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'student.new@dut.udn.vn',
        passwordHash: 'hashed-password',
        studentCode: '21IT999',
      }),
    );
    expect(repository.createRefreshToken).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: baseUser.id,
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
      },
    });
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  it('rejects an already registered email', async () => {
    const { service } = buildService({
      findUserByEmail: vi.fn().mockResolvedValue(baseUser),
    });

    await expect(
      service.register(
        {
          fullName: 'Nguyen Van A',
          email: 'student.new@dut.udn.vn',
          password: 'Password@123',
          studentCode: '21IT999',
        },
        {},
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
    });
  });

  it('rejects an already registered student code', async () => {
    const { service } = buildService({
      findUserByStudentCode: vi.fn().mockResolvedValue(baseUser),
    });

    await expect(
      service.register(
        {
          fullName: 'Nguyen Van A',
          email: 'student.new@dut.udn.vn',
          password: 'Password@123',
          studentCode: '21IT999',
        },
        {},
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
    });
  });
});

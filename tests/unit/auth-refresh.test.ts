import { Role, WorkspaceType, type User, type Workspace } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../src/modules/auth/auth.service';
import { sha256 } from '../../src/shared/utils/hash';

const workspace: Workspace = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'PILOT-SCHOOL',
  type: WorkspaceType.SCHOOL,
  parentWorkspaceId: null,
  name: 'Pilot School',
  shortName: 'Pilot',
  isActive: true,
  registrationEnabled: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const user: User & { workspace: Workspace } = {
  id: '2e2031e8-bd75-4d93-9b7a-78a8f31f4e22',
  workspaceId: workspace.id,
  fullName: 'Pilot Student',
  email: 'student@example.test',
  passwordHash: 'hash',
  phone: null,
  role: Role.student,
  studentCode: 'SV001',
  className: null,
  faculty: null,
  avatarUrl: null,
  isActive: true,
  lastLoginAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  workspace,
};

const refreshToken = 'old-refresh-token';
const tokenRecord = {
  id: 'refresh-record-1',
  userId: user.id,
  tokenHash: sha256(refreshToken),
  expiresAt: new Date(Date.now() + 60_000),
  revokedAt: null,
};

function buildService(options: { user?: typeof user | null; rotated?: boolean } = {}) {
  const repository = {
    findActiveRefreshTokens: vi.fn().mockResolvedValue([tokenRecord]),
    findUserById: vi.fn().mockResolvedValue(options.user === undefined ? user : options.user),
    rotateRefreshToken: vi.fn().mockResolvedValue(options.rotated ?? true),
  };
  const tokenService = {
    verifyRefreshToken: vi.fn().mockReturnValue({ sub: user.id, type: 'refresh' }),
    createAccessToken: vi.fn().mockReturnValue('new-access-token'),
    createRefreshToken: vi.fn().mockReturnValue({
      token: 'rotated',
      expiresAt: new Date(Date.now() + 60_000),
    }),
  };
  const service = new AuthService(repository as never, {} as never, tokenService as never);
  return { service, repository };
}

describe('AuthService.refresh', () => {
  it('revalidates inactive users before rotating a token', async () => {
    const { service, repository } = buildService({ user: { ...user, isActive: false } });

    await expect(service.refresh({ refreshToken })).rejects.toMatchObject({
      statusCode: 403,
      code: 'USER_INACTIVE',
    });
    expect(repository.rotateRefreshToken).not.toHaveBeenCalled();
  });

  it('revalidates workspace availability and leaves the token unrotated when inactive', async () => {
    const inactiveUser = {
      ...user,
      workspace: { ...workspace, isActive: false },
    };
    const { service, repository } = buildService({ user: inactiveUser });

    await expect(service.refresh({ refreshToken })).rejects.toMatchObject({
      statusCode: 403,
      code: 'WORKSPACE_INACTIVE',
    });
    expect(repository.rotateRefreshToken).not.toHaveBeenCalled();
  });

  it('rotates once and rejects a concurrent replay when the old token was already consumed', async () => {
    const { service, repository } = buildService({ rotated: false });

    await expect(service.refresh({ refreshToken })).rejects.toMatchObject({
      statusCode: 401,
      code: 'REFRESH_TOKEN_REVOKED',
    });
    expect(repository.rotateRefreshToken).toHaveBeenCalledWith(
      tokenRecord.id,
      expect.objectContaining({ userId: user.id, tokenHash: sha256('rotated') }),
    );
  });

  it('persists the rotated token and returns a new access token', async () => {
    const { service, repository } = buildService();

    await expect(service.refresh({ refreshToken })).resolves.toMatchObject({
      accessToken: 'new-access-token',
      refreshToken: 'rotated',
    });
    expect(repository.rotateRefreshToken).toHaveBeenCalledTimes(1);
  });
});

describe('AuthService.logout', () => {
  it('revokes only the matching active token when a token is supplied', async () => {
    const repository = {
      findActiveRefreshTokens: vi
        .fn()
        .mockResolvedValue([
          tokenRecord,
          { ...tokenRecord, id: 'other', tokenHash: sha256('other') },
        ]),
      revokeRefreshToken: vi.fn().mockResolvedValue({}),
      revokeAllRefreshTokens: vi.fn().mockResolvedValue({ count: 0 }),
    };
    const service = new AuthService(repository as never, {} as never, {} as never);

    await service.logout(user.id, { refreshToken });

    expect(repository.revokeRefreshToken).toHaveBeenCalledWith(tokenRecord.id);
    expect(repository.revokeAllRefreshTokens).not.toHaveBeenCalled();
  });

  it('revokes all active refresh tokens when no token is supplied', async () => {
    const repository = {
      findActiveRefreshTokens: vi.fn(),
      revokeRefreshToken: vi.fn(),
      revokeAllRefreshTokens: vi.fn().mockResolvedValue({ count: 2 }),
    };
    const service = new AuthService(repository as never, {} as never, {} as never);

    await service.logout(user.id, {});

    expect(repository.revokeAllRefreshTokens).toHaveBeenCalledWith(user.id);
    expect(repository.findActiveRefreshTokens).not.toHaveBeenCalled();
  });
});

import { Role, WorkspaceType } from '@prisma/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import { sha256 } from '../../shared/utils/hash';
import { pickSafeUser } from '../../shared/utils/pick-safe-user';
import { AuthRepository } from './auth.repository';
import type { LoginInput, LogoutInput, RefreshInput, RegisterInput } from './auth.validation';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

export class AuthService {
  constructor(
    private readonly authRepository = new AuthRepository(),
    private readonly passwordService = new PasswordService(),
    private readonly tokenService = new TokenService(),
  ) {}

  async register(input: RegisterInput, context: { userAgent?: string; ipAddress?: string }) {
    const workspace = await this.authRepository.findWorkspaceById(input.workspaceId);

    if (!workspace) {
      throw new AppError(404, ErrorCodes.WORKSPACE_NOT_FOUND, 'Workspace not found');
    }

    if (!workspace.isActive) {
      throw new AppError(403, ErrorCodes.WORKSPACE_INACTIVE, 'Workspace is inactive');
    }

    if (workspace.type !== WorkspaceType.SCHOOL) {
      throw new AppError(
        403,
        ErrorCodes.WORKSPACE_REGISTRATION_CLOSED,
        'Student registration is only available for School workspaces',
      );
    }

    if (!workspace.registrationEnabled) {
      throw new AppError(
        403,
        ErrorCodes.WORKSPACE_REGISTRATION_CLOSED,
        'Workspace registration is closed',
      );
    }

    const existingEmail = await this.authRepository.findUserByEmail(input.email);

    if (existingEmail) {
      throw new AppError(409, ErrorCodes.CONFLICT, 'Email is already registered');
    }

    const existingStudentCode = await this.authRepository.findUserByStudentCode(
      input.workspaceId,
      input.studentCode,
    );

    if (existingStudentCode) {
      throw new AppError(409, ErrorCodes.CONFLICT, 'Student code is already registered');
    }

    const passwordHash = await this.passwordService.hashPassword(input.password);
    let user;
    try {
      user = await this.authRepository.createStudentUser({
        workspaceId: input.workspaceId,
        fullName: input.fullName,
        email: input.email,
        passwordHash,
        studentCode: input.studentCode,
        className: input.className,
        faculty: input.faculty,
        phone: input.phone,
        lastLoginAt: new Date(),
      });
    } catch (error) {
      const conflict = registrationUniqueConstraintError(error);
      if (conflict) throw conflict;
      throw error;
    }

    const accessToken = this.tokenService.createAccessToken(user.id);
    const refreshToken = this.tokenService.createRefreshToken(user.id);

    await this.authRepository.createRefreshToken({
      userId: user.id,
      tokenHash: sha256(refreshToken.token),
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
      expiresAt: refreshToken.expiresAt,
    });

    return {
      user: pickSafeUser(user),
      accessToken,
      refreshToken: refreshToken.token,
      ...this.getAccessTokenMetadata(),
    };
  }

  async login(input: LoginInput, context: { userAgent?: string; ipAddress?: string }) {
    const user = await this.authRepository.findUserByEmail(input.email);

    if (!user) {
      throw new AppError(401, ErrorCodes.INVALID_CREDENTIALS, 'Invalid email or password');
    }

    const isPasswordValid = await this.passwordService.verifyPassword(
      input.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new AppError(401, ErrorCodes.INVALID_CREDENTIALS, 'Invalid email or password');
    }

    if (!user.isActive) {
      throw new AppError(403, ErrorCodes.USER_INACTIVE, 'User account is inactive');
    }

    this.assertWorkspaceAvailable(user);

    await this.authRepository.updateLastLogin(user.id);
    const freshUser = await this.authRepository.findUserById(user.id);
    const currentUser = freshUser ?? user;
    if (!currentUser.isActive) {
      throw new AppError(403, ErrorCodes.USER_INACTIVE, 'User account is inactive');
    }
    this.assertWorkspaceAvailable(currentUser);
    const accessToken = this.tokenService.createAccessToken(user.id);
    const refreshToken = this.tokenService.createRefreshToken(user.id);

    await this.authRepository.createRefreshToken({
      userId: user.id,
      tokenHash: sha256(refreshToken.token),
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
      expiresAt: refreshToken.expiresAt,
    });

    return {
      user: pickSafeUser(freshUser ?? user),
      accessToken,
      refreshToken: refreshToken.token,
      ...this.getAccessTokenMetadata(),
    };
  }

  async refresh(input: RefreshInput) {
    const payload = this.tokenService.verifyRefreshToken(input.refreshToken);
    const activeTokens = await this.authRepository.findActiveRefreshTokens(payload.sub);
    const tokenHash = sha256(input.refreshToken);
    const tokenRecord = activeTokens.find((record) => record.tokenHash === tokenHash);

    if (!tokenRecord) {
      throw new AppError(401, ErrorCodes.TOKEN_INVALID, 'Refresh token is invalid');
    }

    if (tokenRecord.revokedAt) {
      throw new AppError(401, ErrorCodes.REFRESH_TOKEN_REVOKED, 'Refresh token is revoked');
    }

    if (tokenRecord.expiresAt.getTime() <= Date.now()) {
      throw new AppError(401, ErrorCodes.TOKEN_EXPIRED, 'Refresh token has expired');
    }

    const refreshToken = this.tokenService.createRefreshToken(payload.sub);
    const user = await this.authRepository.findUserById(payload.sub);
    if (!user) {
      throw new AppError(401, ErrorCodes.TOKEN_INVALID, 'Refresh token is invalid');
    }
    if (!user.isActive) {
      throw new AppError(403, ErrorCodes.USER_INACTIVE, 'User account is inactive');
    }
    this.assertWorkspaceAvailable(user);

    const rotated = await this.authRepository.rotateRefreshToken(tokenRecord.id, {
      userId: payload.sub,
      tokenHash: sha256(refreshToken.token),
      expiresAt: refreshToken.expiresAt,
    });
    if (!rotated) {
      throw new AppError(401, ErrorCodes.REFRESH_TOKEN_REVOKED, 'Refresh token is revoked');
    }
    const accessToken = this.tokenService.createAccessToken(payload.sub);

    return {
      accessToken,
      refreshToken: refreshToken.token,
      ...this.getAccessTokenMetadata(),
    };
  }

  async logout(userId: string, input: LogoutInput): Promise<void> {
    if (!input.refreshToken) {
      await this.authRepository.revokeAllRefreshTokens(userId);
      return;
    }

    const activeTokens = await this.authRepository.findActiveRefreshTokens(userId);
    const tokenHash = sha256(input.refreshToken);
    const tokenRecord = activeTokens.find((record) => record.tokenHash === tokenHash);

    if (tokenRecord) {
      await this.authRepository.revokeRefreshToken(tokenRecord.id);
    }
  }

  private getAccessTokenMetadata() {
    const tokenService = this.tokenService as TokenService & {
      getAccessTokenExpiresInSeconds?: () => number;
      getAccessTokenExpiresAt?: () => Date;
    };
    const expiresIn = tokenService.getAccessTokenExpiresInSeconds?.() ?? 30 * 60;
    const expiresAt =
      tokenService.getAccessTokenExpiresAt?.() ?? new Date(Date.now() + expiresIn * 1000);

    return {
      expiresIn,
      accessTokenExpiresAt: expiresAt.toISOString(),
    };
  }

  private assertWorkspaceAvailable(user: {
    role: Role;
    workspaceId: string | null;
    workspace?: { isActive: boolean } | null;
  }) {
    if (user.role === Role.admin) return;
    if (!user.workspaceId || !user.workspace) {
      throw new AppError(
        403,
        ErrorCodes.USER_WORKSPACE_REQUIRED,
        'User account is missing workspace configuration',
      );
    }
    if (!user.workspace.isActive) {
      throw new AppError(403, ErrorCodes.WORKSPACE_INACTIVE, 'Workspace is inactive');
    }
  }
}

function registrationUniqueConstraintError(error: unknown): AppError | null {
  if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2002') {
    return null;
  }
  const meta =
    'meta' in error && error.meta && typeof error.meta === 'object' ? error.meta : null;
  const rawTarget = meta && 'target' in meta ? meta.target : null;
  const target = Array.isArray(rawTarget)
    ? rawTarget.join('_').toLowerCase()
    : String(rawTarget ?? '').toLowerCase();
  if (target.includes('email')) {
    return new AppError(409, ErrorCodes.CONFLICT, 'Email is already registered');
  }
  if (target.includes('studentcode') || target.includes('workspaceid')) {
    return new AppError(409, ErrorCodes.CONFLICT, 'Student code is already registered');
  }
  return null;
}

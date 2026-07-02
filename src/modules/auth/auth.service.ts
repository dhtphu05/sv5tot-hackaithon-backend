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
    const existingEmail = await this.authRepository.findUserByEmail(input.email);

    if (existingEmail) {
      throw new AppError(409, ErrorCodes.CONFLICT, 'Email is already registered');
    }

    const existingStudentCode = await this.authRepository.findUserByStudentCode(input.studentCode);

    if (existingStudentCode) {
      throw new AppError(409, ErrorCodes.CONFLICT, 'Student code is already registered');
    }

    const passwordHash = await this.passwordService.hashPassword(input.password);
    const user = await this.authRepository.createStudentUser({
      fullName: input.fullName,
      email: input.email,
      passwordHash,
      studentCode: input.studentCode,
      className: input.className,
      faculty: input.faculty,
      phone: input.phone,
      lastLoginAt: new Date(),
    });

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

    await this.authRepository.updateLastLogin(user.id);
    const freshUser = await this.authRepository.findUserById(user.id);
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

    await this.authRepository.revokeRefreshToken(tokenRecord.id);
    const accessToken = this.tokenService.createAccessToken(payload.sub);
    const refreshToken = this.tokenService.createRefreshToken(payload.sub);

    await this.authRepository.createRefreshToken({
      userId: payload.sub,
      tokenHash: sha256(refreshToken.token),
      expiresAt: refreshToken.expiresAt,
    });

    return {
      accessToken,
      refreshToken: refreshToken.token,
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
}

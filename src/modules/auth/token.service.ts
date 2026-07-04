import { randomUUID } from 'node:crypto';
import jwt, { TokenExpiredError } from 'jsonwebtoken';
import { env } from '../../config/env';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AccessTokenPayload, RefreshTokenPayload } from '../../shared/types/auth';

function durationToSeconds(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match) {
    return Number(value);
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 24 * 60 * 60,
  };

  return amount * multipliers[unit];
}

export class TokenService {
  getAccessTokenExpiresInSeconds(): number {
    return durationToSeconds(env.JWT_ACCESS_EXPIRES_IN);
  }

  getAccessTokenExpiresAt(): Date {
    return new Date(Date.now() + this.getAccessTokenExpiresInSeconds() * 1000);
  }

  createAccessToken(userId: string): string {
    return jwt.sign(
      { sub: userId, type: 'access' } satisfies AccessTokenPayload,
      env.JWT_ACCESS_SECRET,
      {
        expiresIn: durationToSeconds(env.JWT_ACCESS_EXPIRES_IN),
      },
    );
  }

  createRefreshToken(userId: string): { token: string; jti: string; expiresAt: Date } {
    const jti = randomUUID();
    const expiresInSeconds = durationToSeconds(env.JWT_REFRESH_EXPIRES_IN);
    const token = jwt.sign(
      { sub: userId, type: 'refresh', jti } satisfies RefreshTokenPayload,
      env.JWT_REFRESH_SECRET,
      { expiresIn: expiresInSeconds },
    );

    return {
      token,
      jti,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    };
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    return this.verifyToken<AccessTokenPayload>(token, env.JWT_ACCESS_SECRET, 'access');
  }

  verifyRefreshToken(token: string): RefreshTokenPayload {
    return this.verifyToken<RefreshTokenPayload>(token, env.JWT_REFRESH_SECRET, 'refresh');
  }

  private verifyToken<T extends { type: string }>(token: string, secret: string, type: string): T {
    try {
      const payload = jwt.verify(token, secret) as T;
      if (payload.type !== type) {
        throw new AppError(401, ErrorCodes.TOKEN_INVALID, 'Token type is invalid');
      }
      return payload;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      if (error instanceof TokenExpiredError) {
        throw new AppError(401, ErrorCodes.TOKEN_EXPIRED, 'Token has expired');
      }

      throw new AppError(401, ErrorCodes.TOKEN_INVALID, 'Token is invalid');
    }
  }
}

import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';

export class AuthRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  findUserByEmail(email: string) {
    return this.db.user.findUnique({ where: { email } });
  }

  findUserById(id: string) {
    return this.db.user.findUnique({ where: { id } });
  }

  updateLastLogin(userId: string) {
    return this.db.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  }

  createRefreshToken(input: {
    userId: string;
    tokenHash: string;
    userAgent?: string;
    ipAddress?: string;
    expiresAt: Date;
  }) {
    return this.db.refreshToken.create({ data: input });
  }

  findActiveRefreshTokens(userId: string) {
    return this.db.refreshToken.findMany({
      where: {
        userId,
        revokedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  revokeRefreshToken(id: string) {
    return this.db.refreshToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  revokeAllRefreshTokens(userId: string) {
    return this.db.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }
}

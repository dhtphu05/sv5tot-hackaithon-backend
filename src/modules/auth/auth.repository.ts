import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';

export class AuthRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  private readonly userWithWorkspaceInclude = {
    workspace: {
      select: {
        id: true,
        code: true,
        name: true,
        shortName: true,
      },
    },
  } as const;

  findUserByEmail(email: string) {
    return this.db.user.findUnique({
      where: { email },
      include: this.userWithWorkspaceInclude,
    });
  }

  findUserByStudentCode(workspaceId: string, studentCode: string) {
    return this.db.user.findUnique({
      where: {
        workspaceId_studentCode: {
          workspaceId,
          studentCode,
        },
      },
      include: this.userWithWorkspaceInclude,
    });
  }

  findUserById(id: string) {
    return this.db.user.findUnique({
      where: { id },
      include: this.userWithWorkspaceInclude,
    });
  }

  findWorkspaceById(id: string) {
    return this.db.workspace.findUnique({ where: { id } });
  }

  createStudentUser(input: {
    workspaceId: string;
    fullName: string;
    email: string;
    passwordHash: string;
    studentCode: string;
    className?: string;
    faculty?: string;
    phone?: string;
    lastLoginAt?: Date;
  }) {
    return this.db.user.create({
      data: {
        ...input,
        role: 'student',
      },
      include: this.userWithWorkspaceInclude,
    });
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

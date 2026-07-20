import type { FileStorageType, Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { workspaceFilterFor } from '../../shared/utils/workspace-scope';
import type { ListUsersQuery, UpdateMeInput } from './users.validation';

export class UsersRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  findById(id: string) {
    return this.db.user.findUnique({
      where: { id },
      include: {
        workspace: {
          select: {
            id: true,
            code: true,
            name: true,
            shortName: true,
          },
        },
        officerSpecializations: {
          where: { isActive: true },
          select: {
            criterion: true,
            facultyScope: true,
            isActive: true,
          },
        },
      },
    });
  }

  updateById(id: string, data: UpdateMeInput) {
    return this.db.user.update({
      where: { id },
      data,
      include: {
        workspace: {
          select: {
            id: true,
            code: true,
            name: true,
            shortName: true,
          },
        },
      },
    });
  }

  async createAvatarFileAndUpdateUser(input: {
    userId: string;
    storageType: FileStorageType;
    filePath: string;
    originalName: string;
    mimeType: string;
    fileSize: number;
  }) {
    return this.db.$transaction(async (tx) => {
      const owner = await tx.user.findUnique({
        where: { id: input.userId },
        select: { workspaceId: true },
      });
      const file = await tx.file.create({
        data: {
          ownerId: input.userId,
          workspaceId: owner?.workspaceId ?? null,
          storageType: input.storageType,
          filePath: input.filePath,
          publicUrl: null,
          originalName: input.originalName,
          mimeType: input.mimeType,
          fileSize: input.fileSize,
          uploadedBy: input.userId,
        },
      });

      return tx.user.update({
        where: { id: input.userId },
        data: { avatarUrl: `file:${file.id}` },
        include: {
          workspace: {
            select: {
              id: true,
              code: true,
              name: true,
              shortName: true,
            },
          },
        },
      });
    });
  }

  async list(user: AuthenticatedUser, query: ListUsersQuery) {
    const where: Prisma.UserWhereInput = {
      ...workspaceFilterFor(user),
      ...(query.role ? { role: query.role } : {}),
      ...(query.faculty ? { faculty: query.faculty } : {}),
      ...(query.q
        ? {
            OR: [
              { fullName: { contains: query.q, mode: 'insensitive' } },
              { email: { contains: query.q, mode: 'insensitive' } },
              { studentCode: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const skip = (query.page - 1) * query.limit;
    const [users, total] = await this.db.$transaction([
      this.db.user.findMany({
        where,
        include: {
          workspace: {
            select: {
              id: true,
              code: true,
              name: true,
              shortName: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.limit,
      }),
      this.db.user.count({ where }),
    ]);

    return { users, total };
  }
}

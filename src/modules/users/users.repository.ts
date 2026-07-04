import type { FileStorageType, Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import type { ListUsersQuery, UpdateMeInput } from './users.validation';

export class UsersRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  findById(id: string) {
    return this.db.user.findUnique({
      where: { id },
      include: {
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
      const file = await tx.file.create({
        data: {
          ownerId: input.userId,
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
      });
    });
  }

  async list(query: ListUsersQuery) {
    const where: Prisma.UserWhereInput = {
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
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.limit,
      }),
      this.db.user.count({ where }),
    ]);

    return { users, total };
  }
}

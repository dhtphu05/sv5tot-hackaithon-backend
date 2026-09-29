import type { Criterion, FileStorageType, Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { workspaceFilterFor } from '../../shared/utils/workspace-scope';
import type { ListAdminUsersQuery, ListUsersQuery, UpdateMeInput } from './users.validation';

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

  async listAdmin(query: ListAdminUsersQuery) {
    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.faculty ? { faculty: query.faculty } : {}),
      ...(query.q ? { OR: [
        { fullName: { contains: query.q, mode: 'insensitive' } },
        { email: { contains: query.q, mode: 'insensitive' } },
        { studentCode: { contains: query.q, mode: 'insensitive' } },
      ] } : {}),
    };
    const skip = (query.page - 1) * query.limit;
    const [users, total] = await this.db.$transaction([
      this.db.user.findMany({
        where,
        select: {
          id: true, workspaceId: true, fullName: true, email: true, phone: true, role: true,
          studentCode: true, className: true, faculty: true, avatarUrl: true, isActive: true,
          lastLoginAt: true, createdAt: true, updatedAt: true,
          workspace: { select: { id: true, code: true, name: true, shortName: true } },
          officerSpecializations: { where: { isActive: true }, select: { criterion: true, facultyScope: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { fullName: 'asc' }], skip, take: query.limit,
      }),
      this.db.user.count({ where }),
    ]);
    return { users, total };
  }

  findAdminById(id: string) {
    return this.db.user.findUnique({
      where: { id },
      select: {
        id: true, workspaceId: true, fullName: true, email: true, phone: true, role: true,
        studentCode: true, className: true, faculty: true, avatarUrl: true, isActive: true,
        lastLoginAt: true, createdAt: true, updatedAt: true,
        workspace: { select: { id: true, code: true, name: true, shortName: true } },
        officerSpecializations: { select: { id: true, criterion: true, facultyScope: true, isActive: true } },
      },
    });
  }

  findAdminByEmail(email: string, exceptUserId?: string) {
    return this.db.user.findFirst({ where: { email, ...(exceptUserId ? { id: { not: exceptUserId } } : {}) }, select: { id: true } });
  }

  findWorkspaceAdmin(id: string) {
    return this.db.workspace.findUnique({ where: { id }, select: { id: true, type: true, isActive: true } });
  }

  createAdminUser(data: Prisma.UserUncheckedCreateInput) {
    return this.db.user.create({
      data,
      select: {
        id: true, workspaceId: true, fullName: true, email: true, phone: true, role: true,
        studentCode: true, className: true, faculty: true, avatarUrl: true, isActive: true,
        lastLoginAt: true, createdAt: true, updatedAt: true,
        workspace: { select: { id: true, code: true, name: true, shortName: true } },
        officerSpecializations: { where: { isActive: true }, select: { criterion: true, facultyScope: true } },
      },
    });
  }

  updateAdminUser(id: string, data: Prisma.UserUncheckedUpdateInput) {
    return this.db.user.update({
      where: { id }, data,
      select: {
        id: true, workspaceId: true, fullName: true, email: true, phone: true, role: true,
        studentCode: true, className: true, faculty: true, avatarUrl: true, isActive: true,
        lastLoginAt: true, createdAt: true, updatedAt: true,
        workspace: { select: { id: true, code: true, name: true, shortName: true } },
        officerSpecializations: { where: { isActive: true }, select: { criterion: true, facultyScope: true } },
      },
    });
  }

  setAdminUserActive(id: string, isActive: boolean) {
    return this.updateAdminUser(id, { isActive });
  }

  revokeRefreshTokensForUser(userId: string) {
    return this.db.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async hasWorkflowReferences(userId: string) {
    const [applications, assignedTasks, awards, matchedAwardRecipients, audits, finalHistory] = await Promise.all([
      this.db.application.count({ where: { studentId: userId } }),
      this.db.reviewTask.count({ where: { assignedOfficerId: userId } }),
      this.db.awardDecision.count({ where: { OR: [{ createdById: userId }, { confirmedById: userId }] } }),
      this.db.awardRecipient.count({ where: { matchedUserId: userId } }),
      this.db.auditLog.count({ where: { actorId: userId } }),
      this.db.applicationFinalDecisionHistory.count({ where: { OR: [{ finalizedById: userId }, { supersededById: userId }] } }),
    ]);
    return applications + assignedTasks + awards + matchedAwardRecipients + audits + finalHistory > 0;
  }

  listOfficerSpecializations(officerId: string) {
    return this.db.officerSpecialization.findMany({ where: { officerId }, orderBy: [{ criterion: 'asc' }, { facultyScope: 'asc' }] });
  }

  async countActiveAssignmentsForCriteria(officerId: string, criteria: Criterion[]) {
    if (criteria.length === 0) return 0;
    return this.db.reviewTask.count({
      where: { assignedOfficerId: officerId, criterion: { in: criteria }, status: { notIn: ['accepted', 'rejected'] } },
    });
  }

  async replaceOfficerSpecializations(officerId: string, criteria: Criterion[]) {
    return this.db.$transaction(async (tx) => {
      await tx.officerSpecialization.updateMany({
        where: { officerId, ...(criteria.length ? { criterion: { notIn: criteria } } : {}) },
        data: { isActive: false },
      });
      for (const criterion of criteria) {
        const row = await tx.officerSpecialization.findFirst({ where: { officerId, criterion, facultyScope: null } });
        if (row) await tx.officerSpecialization.update({ where: { id: row.id }, data: { isActive: true } });
        else await tx.officerSpecialization.create({ data: { officerId, criterion, facultyScope: null, isActive: true } });
      }
      return tx.officerSpecialization.findMany({ where: { officerId, isActive: true } });
    });
  }
}

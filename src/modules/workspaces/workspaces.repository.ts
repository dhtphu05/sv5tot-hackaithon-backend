import { Role, type Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';

export type AdminWorkspaceListArgs = {
  where: Prisma.WorkspaceWhereInput;
  skip: number;
  take: number;
};

export type AdminWorkspaceUserListArgs = {
  workspaceId: string;
  where: Prisma.UserWhereInput;
  skip: number;
  take: number;
};

export class WorkspacesRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  list(where: Prisma.WorkspaceWhereInput = {}) {
    return this.db.workspace.findMany({
      where,
      select: {
        id: true,
        code: true,
        name: true,
        shortName: true,
      },
      orderBy: [{ name: 'asc' }, { code: 'asc' }],
    });
  }

  async listAdmin(args: AdminWorkspaceListArgs) {
    const [items, total] = await this.db.$transaction([
      this.db.workspace.findMany({
        where: args.where,
        select: {
          id: true,
          code: true,
          name: true,
          shortName: true,
          isActive: true,
          registrationEnabled: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              users: true,
              applications: true,
            },
          },
        },
        orderBy: [{ name: 'asc' }, { code: 'asc' }],
        skip: args.skip,
        take: args.take,
      }),
      this.db.workspace.count({ where: args.where }),
    ]);

    return { items, total };
  }

  findById(workspaceId: string) {
    return this.db.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        code: true,
        name: true,
        shortName: true,
        isActive: true,
        registrationEnabled: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            users: true,
            applications: true,
          },
        },
      },
    });
  }

  findByCode(code: string) {
    return this.db.workspace.findUnique({
      where: { code },
      select: { id: true },
    });
  }

  create(data: Prisma.WorkspaceCreateInput) {
    return this.db.workspace.create({
      data,
      select: {
        id: true,
        code: true,
        name: true,
        shortName: true,
        isActive: true,
        registrationEnabled: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            users: true,
            applications: true,
          },
        },
      },
    });
  }

  update(workspaceId: string, data: Prisma.WorkspaceUpdateInput) {
    return this.db.workspace.update({
      where: { id: workspaceId },
      data,
      select: {
        id: true,
        code: true,
        name: true,
        shortName: true,
        isActive: true,
        registrationEnabled: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            users: true,
            applications: true,
          },
        },
      },
    });
  }

  countUsersByRole(workspaceId: string) {
    return this.db.user.groupBy({
      by: ['role'],
      where: { workspaceId },
      _count: { _all: true },
    });
  }

  countApplicationsByStatus(workspaceId: string) {
    return this.db.application.groupBy({
      by: ['status'],
      where: { workspaceId },
      _count: { _all: true },
    });
  }

  findLatestActiveCriteria(workspaceId: string) {
    return this.db.criteriaVersion.findFirst({
      where: { workspaceId, isActive: true },
      select: {
        id: true,
        schoolYear: true,
        unitScope: true,
        level: true,
        versionName: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ schoolYear: 'desc' }, { createdAt: 'desc' }],
    });
  }

  countActiveCriteria(workspaceId: string) {
    return this.db.criteriaVersion.count({
      where: { workspaceId, isActive: true },
    });
  }

  countRole(workspaceId: string, role: Role) {
    return this.db.user.count({
      where: { workspaceId, role, isActive: true },
    });
  }

  async listWorkspaceUsers(args: AdminWorkspaceUserListArgs) {
    const where: Prisma.UserWhereInput = {
      ...args.where,
      workspaceId: args.workspaceId,
    };

    const [items, total] = await this.db.$transaction([
      this.db.user.findMany({
        where,
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          studentCode: true,
          faculty: true,
          className: true,
          isActive: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { fullName: 'asc' }],
        skip: args.skip,
        take: args.take,
      }),
      this.db.user.count({ where }),
    ]);

    return { items, total };
  }
}

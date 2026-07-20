// Owns officer review tasks, decisions, supplements, and escalation persistence.
import { Role, type Prisma } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { workspaceFilterFor } from '../../shared/utils/workspace-scope';
import type { ListReviewTasksQuery } from './review.validation';

export const reviewTaskListInclude = {
  application: { include: { student: true } },
  collectiveProfile: { include: { representative: true } },
  assignedOfficer: { select: { id: true, fullName: true } },
  evidences: {
    include: {
      evidence: {
        select: {
          status: true,
          confidence: true,
          evidenceCard: {
            select: {
              confidence: true,
              warningsJson: true,
            },
          },
        },
      },
    },
  },
  _count: { select: { evidences: true } },
} satisfies Prisma.ReviewTaskInclude;

export const reviewTaskDetailInclude = {
  application: {
    include: {
      student: true,
      metrics: true,
      precheckResults: { orderBy: { createdAt: 'desc' }, take: 1 },
      cascadeReviews: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  },
  collectiveProfile: {
    include: {
      representative: true,
      members: true,
      precheckResults: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  },
  assignedOfficer: true,
  evidences: {
    include: {
      evidence: {
        include: {
          evidenceFiles: { include: { file: true } },
          evidenceCard: true,
          event: true,
        },
      },
    },
  },
} satisfies Prisma.ReviewTaskInclude;

export class ReviewRepository {
  async buildTaskWhere(
    user: AuthenticatedUser,
    query: ListReviewTasksQuery,
  ): Promise<Prisma.ReviewTaskWhereInput> {
    const search = query.q ?? query.search;
    const now = new Date();
    const dueSoonLimit = new Date(now);
    dueSoonLimit.setDate(dueSoonLimit.getDate() + 3);

    const andFilters: Prisma.ReviewTaskWhereInput[] = [];
    andFilters.push(workspaceFilterFor(user));
    if (query.status) andFilters.push({ status: query.status });
    if (query.supplementRequired) andFilters.push({ status: 'supplement_required' });
    if (query.resolutionNeeded) andFilters.push({ status: 'resolution_needed' });
    if (query.criterion) andFilters.push({ criterion: query.criterion });
    if (query.applicationId) andFilters.push({ applicationId: query.applicationId });
    if (query.assignedOfficerId) andFilters.push({ assignedOfficerId: query.assignedOfficerId });
    if (query.targetLevel) {
      andFilters.push({
        OR: [
          { application: { targetLevel: query.targetLevel } },
          { collectiveProfile: { targetLevel: query.targetLevel } },
        ],
      });
    }
    if (query.faculty) {
      andFilters.push({
        OR: [
          { application: { student: { faculty: query.faculty } } },
          { collectiveProfile: { representative: { faculty: query.faculty } } },
        ],
      });
    }
    if (query.className) {
      andFilters.push({
        OR: [
          { application: { student: { className: query.className } } },
          { collectiveProfile: { className: query.className } },
        ],
      });
    }
    if (query.aiConfidenceMax !== undefined) {
      andFilters.push({
        evidences: {
          some: {
            evidence: {
              OR: [
                { confidence: { lte: query.aiConfidenceMax } },
                { evidenceCard: { confidence: { lte: query.aiConfidenceMax } } },
              ],
            },
          },
        },
      });
    }
    if (query.overdue) andFilters.push({ dueDate: { lt: now } });
    if (query.dueSoon) andFilters.push({ dueDate: { gte: now, lte: dueSoonLimit } });
    if (search) {
      andFilters.push({
        OR: [
          {
            application: { student: { fullName: { contains: search, mode: 'insensitive' } } },
          },
          {
            application: {
              student: { studentCode: { contains: search, mode: 'insensitive' } },
            },
          },
          {
            collectiveProfile: {
              className: { contains: search, mode: 'insensitive' },
            },
          },
          {
            evidences: {
              some: {
                evidence: { evidenceName: { contains: search, mode: 'insensitive' } },
              },
            },
          },
        ],
      });
    }
    const base: Prisma.ReviewTaskWhereInput = andFilters.length ? { AND: andFilters } : {};

    if (user.role === Role.manager || user.role === Role.admin) {
      return query.assignedToMe ? { ...base, assignedOfficerId: user.id } : base;
    }

    if (user.role === Role.committee) {
      return { ...base, status: query.status ?? 'resolution_needed' };
    }

    const specializations = await prisma.officerSpecialization.findMany({
      where: { officerId: user.id, isActive: true },
      select: { criterion: true },
    });
    const criteria = Array.from(new Set(specializations.map((item) => item.criterion)));

    return {
      ...base,
      OR: [
        { assignedOfficerId: user.id },
        ...(criteria.length
          ? [
              {
                criterion: { in: criteria },
              },
            ]
          : []),
      ],
    };
  }

  async list(user: AuthenticatedUser, query: ListReviewTasksQuery) {
    const limit = query.pageSize ?? query.limit;
    const skip = (query.page - 1) * limit;
    const where = await this.buildTaskWhere(user, query);
    const [items, total] = await prisma.$transaction([
      prisma.reviewTask.findMany({
        where,
        include: reviewTaskListInclude,
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      prisma.reviewTask.count({ where }),
    ]);

    return { items, total };
  }

  findDetail(taskId: string) {
    return prisma.reviewTask.findUnique({
      where: { id: taskId },
      include: reviewTaskDetailInclude,
    });
  }
}

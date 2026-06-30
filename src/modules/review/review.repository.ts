// Owns officer review tasks, decisions, supplements, and escalation persistence.
import { Role, type Prisma } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import type { AuthenticatedUser } from '../../shared/types/auth';
import type { ListReviewTasksQuery } from './review.validation';

export const reviewTaskListInclude = {
  application: { include: { student: true } },
  collectiveProfile: { include: { representative: true } },
  assignedOfficer: true,
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
  buildTaskWhere(
    user: AuthenticatedUser,
    query: ListReviewTasksQuery,
  ): Prisma.ReviewTaskWhereInput {
    const base: Prisma.ReviewTaskWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.criterion ? { criterion: query.criterion } : {}),
      ...(query.applicationId ? { applicationId: query.applicationId } : {}),
      ...(query.q
        ? {
            OR: [
              {
                application: { student: { fullName: { contains: query.q, mode: 'insensitive' } } },
              },
              {
                application: {
                  student: { studentCode: { contains: query.q, mode: 'insensitive' } },
                },
              },
              {
                collectiveProfile: {
                  className: { contains: query.q, mode: 'insensitive' },
                },
              },
              {
                evidences: {
                  some: {
                    evidence: { evidenceName: { contains: query.q, mode: 'insensitive' } },
                  },
                },
              },
            ],
          }
        : {}),
    };

    if (user.role === Role.manager || user.role === Role.admin) {
      return query.assignedToMe ? { ...base, assignedOfficerId: user.id } : base;
    }

    if (user.role === Role.committee) {
      return { ...base, status: query.status ?? 'resolution_needed' };
    }

    return {
      ...base,
      OR: [
        { assignedOfficerId: user.id },
        {
          assignedOfficerId: null,
          OR: [
            { application: { student: { faculty: user.faculty ?? undefined } } },
            {
              collectiveProfile: {
                representative: { faculty: user.faculty ?? undefined },
              },
            },
          ],
        },
      ],
    };
  }

  async list(user: AuthenticatedUser, query: ListReviewTasksQuery) {
    const skip = (query.page - 1) * query.limit;
    const where = this.buildTaskWhere(user, query);
    const [items, total] = await prisma.$transaction([
      prisma.reviewTask.findMany({
        where,
        include: reviewTaskListInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.limit,
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

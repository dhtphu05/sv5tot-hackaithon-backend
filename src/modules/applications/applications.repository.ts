import { ApplicationType, type Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import type { TimelineQuery } from './applications.validation';

const applicationInclude = {
  metrics: { orderBy: { createdAt: 'asc' } },
  evidences: { select: { criterion: true } },
  reviewTasks: {
    orderBy: { criterion: 'asc' },
    select: {
      id: true,
      criterion: true,
      status: true,
      decision: true,
      officerNote: true,
      decisionReason: true,
      supplementRequestJson: true,
      dueDate: true,
      updatedAt: true,
    },
  },
  draftSnapshots: { orderBy: { version: 'desc' }, take: 1 },
  precheckResults: { orderBy: { createdAt: 'desc' }, take: 1 },
  cascadeReviews: { orderBy: { createdAt: 'desc' }, take: 1 },
  _count: { select: { evidences: true } },
} satisfies Prisma.ApplicationInclude;

export class ApplicationsRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  findCurrent(studentId: string, schoolYear: string) {
    return this.db.application.findUnique({
      where: {
        studentId_schoolYear_applicationType: {
          studentId,
          schoolYear,
          applicationType: ApplicationType.individual,
        },
      },
      include: applicationInclude,
    });
  }

  findById(id: string) {
    return this.db.application.findUnique({
      where: { id },
      include: applicationInclude,
    });
  }

  findBareById(id: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.db;
    return client.application.findUnique({ where: { id } });
  }

  getTimeline(applicationId: string, query: TimelineQuery) {
    const skip = (query.page - 1) * query.limit;
    return this.db.$transaction([
      this.db.auditLog.findMany({
        where: { applicationId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.limit,
        include: {
          actor: {
            select: {
              id: true,
              fullName: true,
              role: true,
            },
          },
        },
      }),
      this.db.auditLog.count({ where: { applicationId } }),
    ]);
  }
}

export { applicationInclude };

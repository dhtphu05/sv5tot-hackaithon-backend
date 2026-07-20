import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';

export const criteriaCompletionApplicationInclude = {
  student: true,
  metrics: true,
  evidences: {
    include: {
      evidenceCard: true,
      event: true,
    },
    orderBy: { createdAt: 'desc' },
  },
  reviewTasks: {
    select: {
      criterion: true,
      status: true,
    },
  },
  requirementResponses: {
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.ApplicationInclude;

export class CriteriaCompletionRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  findApplicationContext(applicationId: string) {
    return this.db.application.findUnique({
      where: { id: applicationId },
      include: criteriaCompletionApplicationInclude,
    });
  }

  findResponseById(responseId: string) {
    return this.db.applicationRequirementResponse.findUnique({
      where: { id: responseId },
      include: {
        application: {
          include: { student: true },
        },
      },
    });
  }

  createResponse(data: Prisma.ApplicationRequirementResponseCreateInput, tx: Prisma.TransactionClient) {
    return tx.applicationRequirementResponse.create({ data });
  }

  updateResponse(
    responseId: string,
    data: Prisma.ApplicationRequirementResponseUpdateInput,
    tx: Prisma.TransactionClient,
  ) {
    return tx.applicationRequirementResponse.update({
      where: { id: responseId },
      data,
    });
  }

  deleteResponse(responseId: string, tx: Prisma.TransactionClient) {
    return tx.applicationRequirementResponse.delete({ where: { id: responseId } });
  }
}

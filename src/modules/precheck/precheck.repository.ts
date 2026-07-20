// Owns persistence for application precheck runs.
import type { Prisma } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';

export const precheckApplicationInclude = {
  student: true,
  metrics: true,
  evidences: {
    include: {
      evidenceCard: true,
      event: true,
    },
    orderBy: { createdAt: 'desc' },
  },
  requirementResponses: true,
  reviewTasks: true,
} satisfies Prisma.ApplicationInclude;

export class PrecheckRepository {
  findApplicationContext(applicationId: string) {
    return prisma.application.findUnique({
      where: { id: applicationId },
      include: precheckApplicationInclude,
    });
  }

  findLatest(applicationId: string) {
    return prisma.precheckResult.findFirst({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
    });
  }
}

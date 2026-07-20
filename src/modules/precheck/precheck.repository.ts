// Owns persistence for application precheck runs.
import { ApplicationType, type Prisma } from '@prisma/client';
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
  findCurrentApplicationForLatest(studentId: string, schoolYear: string) {
    return prisma.application.findUnique({
      where: {
        studentId_schoolYear_applicationType: {
          studentId,
          schoolYear,
          applicationType: ApplicationType.individual,
        },
      },
      select: {
        id: true,
        targetLevel: true,
      },
    });
  }

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

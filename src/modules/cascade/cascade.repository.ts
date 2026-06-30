// Owns persistence for cascade review runs.
import { prisma } from '../../infrastructure/database/prisma';
import { precheckApplicationInclude } from '../precheck/precheck.repository';

export class CascadeRepository {
  findApplicationContext(applicationId: string) {
    return prisma.application.findUnique({
      where: { id: applicationId },
      include: precheckApplicationInclude,
    });
  }

  findLatest(applicationId: string) {
    return prisma.cascadeReview.findFirst({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
    });
  }
}

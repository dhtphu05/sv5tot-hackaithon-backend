import { ApplicationType, type PrismaClient } from '@prisma/client';
import { prisma } from '../../../infrastructure/database/prisma';

export class StudentAssistantRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  findCurrentApplication(studentId: string, schoolYear: string) {
    return this.db.application.findUnique({
      where: {
        studentId_schoolYear_applicationType: {
          studentId,
          schoolYear,
          applicationType: ApplicationType.individual,
        },
      },
      include: {
        student: { select: { id: true, fullName: true, studentCode: true } },
        metrics: { orderBy: { createdAt: 'asc' } },
        requirementResponses: { orderBy: { createdAt: 'asc' } },
        evidences: {
          orderBy: { createdAt: 'desc' },
          include: {
            evidenceCard: true,
            event: true,
          },
        },
        precheckResults: { orderBy: { createdAt: 'desc' }, take: 1 },
        reviewTasks: {
          orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
          select: {
            id: true,
            criterion: true,
            status: true,
            supplementRequestJson: true,
            dueDate: true,
            updatedAt: true,
          },
        },
      },
    });
  }
}

export type StudentAssistantApplication = NonNullable<
  Awaited<ReturnType<StudentAssistantRepository['findCurrentApplication']>>
>;

import { ApplicationType, EventStatus, EvidenceSourceType, type Criterion, type PrismaClient } from '@prisma/client';
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

  findVerifiedImportableEvents(input: {
    applicationId: string;
    workspaceId: string;
    studentCode: string;
    criteria: Criterion[];
    limit?: number;
  }) {
    if (input.criteria.length === 0) return Promise.resolve([]);
    return this.db.eventRegistry.findMany({
      where: {
        workspaceId: input.workspaceId,
        status: EventStatus.active,
        rosterIndexed: true,
        criterion: { in: input.criteria },
        participants: {
          some: {
            studentCode: input.studentCode,
            OR: [
              { participationStatus: null },
              { participationStatus: { equals: 'confirmed', mode: 'insensitive' } },
            ],
          },
        },
        evidences: {
          none: {
            applicationId: input.applicationId,
            sourceType: EvidenceSourceType.event_import,
          },
        },
      },
      select: {
        id: true,
        eventName: true,
        criterion: true,
        organizer: true,
        startDate: true,
        endDate: true,
        convertedValue: true,
        convertedUnit: true,
        updatedAt: true,
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: input.limit ?? 5,
    });
  }
}

export type StudentAssistantApplication = NonNullable<
  Awaited<ReturnType<StudentAssistantRepository['findCurrentApplication']>>
>;

export type VerifiedImportableEvent = Awaited<
  ReturnType<StudentAssistantRepository['findVerifiedImportableEvents']>
>[number];

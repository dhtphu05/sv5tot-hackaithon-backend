import { AwardDecisionStatus, AwardLevel, type PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';

export type ConfirmedUniversityRecipientLookup = {
  issuerWorkspaceId: string;
  institutionWorkspaceId: string;
  schoolYear: string;
};

export class CitySubmissionEligibilityRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  findApplication(id: string) {
    return this.db.application.findUnique({
      where: { id },
      select: { id: true, studentId: true, workspaceId: true, schoolYear: true },
    });
  }

  findWorkspaceContext(id: string) {
    return this.db.workspace.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        parentWorkspaceId: true,
        parentWorkspace: { select: { id: true, type: true } },
      },
    });
  }

  findConfirmedUniversityRecipients(input: ConfirmedUniversityRecipientLookup) {
    return this.db.awardRecipient.findMany({
      where: {
        institutionWorkspaceId: input.institutionWorkspaceId,
        awardDecision: {
          is: {
            issuerWorkspaceId: input.issuerWorkspaceId,
            awardLevel: AwardLevel.UNIVERSITY_SYSTEM,
            schoolYear: input.schoolYear,
            status: AwardDecisionStatus.CONFIRMED,
          },
        },
      },
      select: { studentCode: true, fullName: true, className: true },
    });
  }
}

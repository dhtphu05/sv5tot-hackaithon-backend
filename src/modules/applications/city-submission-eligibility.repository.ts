import { AwardDecisionStatus, type AwardLevel, type PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';

export type ConfirmedAwardLookup = {
  awardLevel: AwardLevel;
  issuerWorkspaceId: string;
  institutionWorkspaceId: string;
  studentCode: string;
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

  async hasConfirmedAward(input: ConfirmedAwardLookup): Promise<boolean> {
    const recipient = await this.db.awardRecipient.findFirst({
      where: {
        studentCode: input.studentCode,
        institutionWorkspaceId: input.institutionWorkspaceId,
        awardDecision: {
          is: {
            issuerWorkspaceId: input.issuerWorkspaceId,
            awardLevel: input.awardLevel,
            schoolYear: input.schoolYear,
            status: AwardDecisionStatus.CONFIRMED,
          },
        },
      },
      select: { id: true },
    });

    return recipient !== null;
  }
}

import {
  ApplicationEligibilityVerificationDecision,
  AwardDecisionStatus,
  AwardLevel,
  type Prisma,
  type PrismaClient,
  type Role,
} from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { auditActions } from '../../shared/constants/application';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import { createApplicationAudit } from './application.helpers';

export type ConfirmedUniversityRecipientLookup = {
  issuerWorkspaceId: string;
  institutionWorkspaceId: string;
  schoolYear: string;
};

export type SaveEligibilityVerificationInput = {
  applicationId: string;
  decision: ApplicationEligibilityVerificationDecision;
  reason: string;
  verificationBasisHash: string;
  actorId: string;
  actorRole: Role;
};

type EligibilityReadClient = PrismaClient | Prisma.TransactionClient;

export class CitySubmissionEligibilityRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  findApplication(id: string, client: EligibilityReadClient = this.db) {
    return client.application.findUnique({
      where: { id },
      select: { id: true, studentId: true, workspaceId: true, schoolYear: true },
    });
  }

  findApplicationForVerification(id: string) {
    return this.db.application.findUnique({
      where: { id },
      select: {
        id: true,
        studentId: true,
        workspaceId: true,
        schoolYear: true,
        applicationType: true,
        targetLevel: true,
        status: true,
        submittedAt: true,
        workspace: { select: { type: true, isActive: true } },
      },
    });
  }

  findStudentIdentity(id: string, client: EligibilityReadClient = this.db) {
    return client.user.findUnique({
      where: { id },
      select: { workspaceId: true, studentCode: true, fullName: true, className: true },
    });
  }

  findManualVerification(applicationId: string, client: EligibilityReadClient = this.db) {
    return client.applicationEligibilityVerification.findUnique({
      where: { applicationId },
      select: { decision: true, verificationBasisHash: true },
    });
  }

  saveVerification(input: SaveEligibilityVerificationInput) {
    return this.db.$transaction(async (tx) => {
      const preSubmitApplication = await tx.$queryRaw<Array<{ id: string; updatedAt: Date }>>`
        SELECT "id", "updatedAt"
        FROM "Application"
        WHERE "id" = ${input.applicationId}::uuid
          AND "applicationType" = 'individual'::"ApplicationType"
          AND "targetLevel" = 'city'::"Level"
          AND "submittedAt" IS NULL
          AND "status" IN (
            'draft'::"ApplicationStatus",
            'prechecked'::"ApplicationStatus",
            'ready_to_submit'::"ApplicationStatus",
            'supplement_required'::"ApplicationStatus"
          )
        FOR UPDATE
      `;
      if (preSubmitApplication.length === 0) {
        throw new AppError(
          409,
          ErrorCodes.APPLICATION_LOCKED,
          'Eligibility can only be verified before the initial submission',
        );
      }

      const decidedAt = new Date(
        Math.max(Date.now(), preSubmitApplication[0].updatedAt.getTime() + 1),
      );
      await tx.application.update({
        where: { id: input.applicationId },
        data: { updatedAt: decidedAt },
      });
      const verification = await tx.applicationEligibilityVerification.upsert({
        where: { applicationId: input.applicationId },
        create: {
          applicationId: input.applicationId,
          decision: input.decision,
          reason: input.reason,
          verificationBasisHash: input.verificationBasisHash,
          decidedById: input.actorId,
          decidedAt,
        },
        update: {
          decision: input.decision,
          reason: input.reason,
          verificationBasisHash: input.verificationBasisHash,
          decidedById: input.actorId,
          decidedAt,
        },
      });

      await createApplicationAudit(tx, {
        actorId: input.actorId,
        actorRole: input.actorRole,
        action:
          input.decision === ApplicationEligibilityVerificationDecision.APPROVED
            ? auditActions.APPLICATION_ELIGIBILITY_VERIFICATION_APPROVED
            : auditActions.APPLICATION_ELIGIBILITY_VERIFICATION_REJECTED,
        targetType: 'application_eligibility_verification',
        targetId: verification.id,
        applicationId: input.applicationId,
        metadataJson: { applicationId: input.applicationId, decision: input.decision },
        afterStateJson: { decision: input.decision },
      });

      return {
        applicationId: verification.applicationId,
        decision: verification.decision,
        decidedAt: verification.decidedAt,
      };
    });
  }

  findWorkspaceContext(id: string, client: EligibilityReadClient = this.db) {
    return client.workspace.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        parentWorkspaceId: true,
        parentWorkspace: { select: { id: true, type: true } },
      },
    });
  }

  lockWorkspaceForEligibility(id: string, tx: Prisma.TransactionClient) {
    return tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "Workspace"
      WHERE "id" = ${id}::uuid
      FOR UPDATE
    `;
  }

  async lockUniversityAwardScope(
    input: ConfirmedUniversityRecipientLookup,
    tx: Prisma.TransactionClient,
  ) {
    const workspace = await this.lockWorkspaceForEligibility(input.issuerWorkspaceId, tx);
    if (workspace.length === 0) return false;

    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "AwardDecision"
      WHERE "issuerWorkspaceId" = ${input.issuerWorkspaceId}::uuid
        AND "awardLevel" = ${AwardLevel.UNIVERSITY_SYSTEM}::"AwardLevel"
        AND (
          "schoolYear" = ${input.schoolYear}
          OR "status" = ${AwardDecisionStatus.DRAFT}::"AwardDecisionStatus"
        )
      ORDER BY "id"
      FOR UPDATE
    `;
    return true;
  }

  findConfirmedUniversityRecipients(
    input: ConfirmedUniversityRecipientLookup,
    client: EligibilityReadClient = this.db,
  ) {
    return client.awardRecipient.findMany({
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

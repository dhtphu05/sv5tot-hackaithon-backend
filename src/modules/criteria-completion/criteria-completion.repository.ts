import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';

export const criteriaCompletionApplicationInclude = {
  student: true,
  workspace: { select: { type: true, isActive: true } },
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

export const criteriaCompletionApplicationSelect = {
  id: true,
  studentId: true,
  workspaceId: true,
  schoolYear: true,
  targetLevel: true,
  student: { select: { faculty: true } },
  workspace: { select: { type: true, isActive: true } },
  metrics: {
    select: {
      id: true,
      metricType: true,
      value: true,
      scale: true,
      verificationStatus: true,
      schoolYear: true,
      source: true,
      supportingEvidenceId: true,
    },
  },
  evidences: {
    select: {
      id: true,
      criterion: true,
      sourceType: true,
      status: true,
      indexingStatus: true,
      confidence: true,
      event: { select: { convertedValue: true, convertedUnit: true } },
      evidenceCard: {
        select: {
          extractedFieldsJson: true,
          normalizedFieldsJson: true,
          confirmedFieldsJson: true,
          confirmationStatus: true,
          requiresHumanConfirmation: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  },
  reviewTasks: { select: { criterion: true, status: true } },
  requirementResponses: {
    select: {
      id: true,
      criterion: true,
      requirementKey: true,
      responseKind: true,
      status: true,
      metricId: true,
      evidenceId: true,
      payloadJson: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.ApplicationSelect;

export class CriteriaCompletionRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  findApplicationContext(applicationId: string) {
    return this.db.application.findUnique({
      where: { id: applicationId },
      include: criteriaCompletionApplicationInclude,
    });
  }

  findApplicationForCompletion(applicationId: string) {
    return this.db.application.findUnique({
      where: { id: applicationId },
      select: criteriaCompletionApplicationSelect,
    });
  }

  findApplicationForGpaDeclaration(applicationId: string) {
    return this.db.application.findUnique({
      where: { id: applicationId },
      select: {
        id: true,
        studentId: true,
        workspaceId: true,
        schoolYear: true,
        targetLevel: true,
        applicationType: true,
        status: true,
        cancelledAt: true,
      },
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

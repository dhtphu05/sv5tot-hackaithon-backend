import { ApplicationStatus, Criterion, Role, type Application, type Prisma } from '@prisma/client';
import { editableApplicationStatuses } from '../../shared/constants/application';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';

type ApplicationWithCounts = Application & {
  _count?: {
    evidences?: number;
  };
  evidences?: Array<{
    criterion: Criterion;
  }>;
  metrics?: unknown[];
};

export function assertApplicationOwner(application: Application, user: AuthenticatedUser): void {
  if (user.role === Role.admin) {
    return;
  }

  if (application.studentId !== user.id) {
    throw new AppError(
      403,
      ErrorCodes.APPLICATION_OWNER_REQUIRED,
      'Application can only be changed by its owner',
    );
  }
}

export function assertApplicationEditable(application: Application): void {
  if (editableApplicationStatuses.includes(application.status as never)) {
    return;
  }

  throw new AppError(
    409,
    ErrorCodes.APPLICATION_LOCKED,
    `Application cannot be edited while status is ${application.status}`,
  );
}

export function buildApplicationSummary(application: ApplicationWithCounts) {
  const evidenceByCriterion = {
    ethics: 0,
    academic: 0,
    physical: 0,
    volunteer: 0,
    integration: 0,
    priority: 0,
  };

  for (const evidence of application.evidences ?? []) {
    if (evidence.criterion in evidenceByCriterion) {
      evidenceByCriterion[evidence.criterion as keyof typeof evidenceByCriterion] += 1;
    }
  }

  return {
    totalEvidences: application._count?.evidences ?? application.evidences?.length ?? 0,
    evidenceByCriterion,
    metricsCompletion: {
      completed: application.metrics?.length ?? 0,
      required: 4,
    },
  };
}

export function createApplicationAudit(
  tx: Prisma.TransactionClient | typeof import('../../infrastructure/database/prisma').prisma,
  input: {
    actorId?: string;
    actorRole?: Role;
    action: string;
    targetType: string;
    targetId: string;
    applicationId?: string | null;
    collectiveProfileId?: string | null;
    beforeStateJson?: Prisma.InputJsonValue;
    afterStateJson?: Prisma.InputJsonValue;
    note?: string;
  },
) {
  return tx.auditLog.create({
    data: {
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      applicationId: input.applicationId,
      collectiveProfileId: input.collectiveProfileId,
      beforeStateJson: input.beforeStateJson,
      afterStateJson: input.afterStateJson,
      note: input.note,
    },
  });
}

export function isEditableStatus(status: ApplicationStatus): boolean {
  return editableApplicationStatuses.includes(status as never);
}

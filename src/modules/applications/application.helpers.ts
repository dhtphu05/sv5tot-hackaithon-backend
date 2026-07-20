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

export async function createApplicationAudit(
  tx: Prisma.TransactionClient | typeof import('../../infrastructure/database/prisma').prisma,
  input: {
    actorId?: string;
    actorRole?: Role;
    action: string;
    targetType: string;
    targetId: string;
    applicationId?: string | null;
    collectiveProfileId?: string | null;
    workspaceId?: string | null;
    evidenceId?: string | null;
    eventId?: string | null;
    metadataJson?: Prisma.InputJsonValue;
    beforeStateJson?: Prisma.InputJsonValue;
    afterStateJson?: Prisma.InputJsonValue;
    note?: string;
  },
) {
  const workspaceId = input.workspaceId ?? (await resolveAuditWorkspaceId(tx, input));
  return tx.auditLog.create({
    data: {
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      workspaceId,
      applicationId: input.applicationId,
      collectiveProfileId: input.collectiveProfileId,
      evidenceId: input.evidenceId,
      eventId: input.eventId,
      metadataJson: input.metadataJson,
      beforeStateJson: input.beforeStateJson,
      afterStateJson: input.afterStateJson,
      note: input.note,
    },
  });
}

async function resolveAuditWorkspaceId(
  tx: Prisma.TransactionClient | typeof import('../../infrastructure/database/prisma').prisma,
  input: {
    targetType: string;
    targetId: string;
    applicationId?: string | null;
    collectiveProfileId?: string | null;
  },
) {
  if (input.applicationId && hasModel(tx, 'application')) {
    const application = await tx.application.findUnique({
      where: { id: input.applicationId },
      select: { workspaceId: true },
    });
    if (application?.workspaceId) return application.workspaceId;
  }
  if (input.collectiveProfileId && hasModel(tx, 'collectiveProfile')) {
    const collectiveProfile = await tx.collectiveProfile.findUnique({
      where: { id: input.collectiveProfileId },
      select: { workspaceId: true },
    });
    if (collectiveProfile?.workspaceId) return collectiveProfile.workspaceId;
  }
  if (!isUuid(input.targetId)) return null;
  if (input.targetType === 'event' && hasModel(tx, 'eventRegistry')) {
    const event = await tx.eventRegistry.findUnique({
      where: { id: input.targetId },
      select: { workspaceId: true },
    });
    return event?.workspaceId ?? null;
  }
  if (input.targetType === 'decision_import' && hasModel(tx, 'decisionImport')) {
    const decisionImport = await tx.decisionImport.findUnique({
      where: { id: input.targetId },
      select: { workspaceId: true },
    });
    return decisionImport?.workspaceId ?? null;
  }
  if (input.targetType === 'file' && hasModel(tx, 'file')) {
    const file = await tx.file.findUnique({
      where: { id: input.targetId },
      select: { workspaceId: true },
    });
    return file?.workspaceId ?? null;
  }
  if (
    (input.targetType === 'job' || input.targetType === 'indexing_job') &&
    hasModel(tx, 'indexingJob')
  ) {
    const job = await tx.indexingJob.findUnique({
      where: { id: input.targetId },
      select: { workspaceId: true },
    });
    return job?.workspaceId ?? null;
  }
  return null;
}

function hasModel<T extends string>(
  tx: Prisma.TransactionClient | typeof import('../../infrastructure/database/prisma').prisma,
  model: T,
): tx is (Prisma.TransactionClient | typeof import('../../infrastructure/database/prisma').prisma) &
  Record<T, { findUnique: (args: unknown) => Promise<{ workspaceId: string | null } | null> }> {
  return Boolean((tx as Record<string, unknown>)[model]);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isEditableStatus(status: ApplicationStatus): boolean {
  return editableApplicationStatuses.includes(status as never);
}

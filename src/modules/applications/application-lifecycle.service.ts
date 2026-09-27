import {
  ApplicationStatus,
  ApplicationType,
  FinalStatus,
  NotificationType,
  Role,
  ReviewTaskStatus,
  WorkspaceType,
  type Prisma,
} from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { auditActions } from '../../shared/constants/application';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { assertReviewWorkspaceAccess } from '../../shared/utils/review-workspace-scope';
import { createApplicationAudit } from './application.helpers';

type CancelApplicationInput = { reason: string };
type ReopenCancelledApplicationInput = { reason: string };
type ArchiveApplicationInput = { reason?: string };

const scopedApplicationInclude = {
  workspace: { select: { type: true, isActive: true } },
} satisfies Prisma.ApplicationInclude;

export class ApplicationLifecycleService {
  async cancel(user: AuthenticatedUser, applicationId: string, input: CancelApplicationInput) {
    const scoped = await this.findScopedCityApplication(user, applicationId);

    return prisma.$transaction(async (tx) => {
      const application = await this.lockAndRead(tx, scoped.id);
      if (application.cancelledAt) {
        throw lifecycleConflict('Application is already cancelled');
      }
      if (!application.submittedAt && !hasCurrentFinal(application)) {
        throw lifecycleConflict('Only submitted or finalized applications can be cancelled');
      }

      const now = new Date();
      const hasFinal = hasCurrentFinal(application);
      if (hasFinal) {
        await tx.applicationFinalDecisionHistory.create({
          data: {
            applicationId,
            finalStatus: application.finalStatus,
            finalLevel: application.finalLevel,
            finalNote: application.finalNote,
            finalizedAt: application.finalizedAt,
            finalizedById: application.finalizedById,
            supersededAt: now,
            supersededById: user.id,
            supersedeReason: input.reason,
          },
        });
      }

      const updated = await tx.application.update({
        where: { id: applicationId },
        data: {
          ...(hasFinal
            ? {
                finalStatus: FinalStatus.pending,
                finalLevel: null,
                finalNote: null,
                finalizedAt: null,
                finalizedById: null,
              }
            : {}),
          cancelledAt: now,
          cancelledById: user.id,
          cancelReason: input.reason,
        },
      });

      if (hasFinal) {
        await createApplicationAudit(tx, {
          actorId: user.id,
          actorRole: user.role,
          action: auditActions.FINAL_DECISION_SUPERSEDED,
          targetType: 'application',
          targetId: applicationId,
          applicationId,
          workspaceId: application.workspaceId,
          beforeStateJson: finalDecisionState(application),
          afterStateJson: { finalStatus: FinalStatus.pending, finalLevel: null },
          note: input.reason,
        });
      }
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.APPLICATION_CANCELLED,
        targetType: 'application',
        targetId: applicationId,
        applicationId,
        workspaceId: application.workspaceId,
        beforeStateJson: lifecycleState(application),
        afterStateJson: lifecycleState(updated),
        note: input.reason,
      });
      await tx.notification.create({
        data: {
          userId: application.studentId,
          workspaceId: application.workspaceId,
          applicationId,
          type: NotificationType.application_updated,
          title: 'Hồ sơ đã dừng xử lý',
          message: `Hồ sơ của bạn đã dừng xử lý.\nLý do: ${input.reason}`,
        },
      });

      return { application: updated, finalDecisionSuperseded: hasFinal };
    });
  }

  async reopenCancelled(
    user: AuthenticatedUser,
    applicationId: string,
    input: ReopenCancelledApplicationInput,
  ) {
    const scoped = await this.findScopedCityApplication(user, applicationId);

    return prisma.$transaction(async (tx) => {
      const application = await this.lockAndRead(tx, scoped.id);
      if (!application.cancelledAt) {
        throw lifecycleConflict('Application is not cancelled');
      }

      let status = application.status;
      if (
        application.status === ApplicationStatus.completed ||
        application.status === ApplicationStatus.rejected
      ) {
        const supersededFinal = await tx.applicationFinalDecisionHistory.findFirst({
          where: { applicationId },
          select: { id: true },
          orderBy: { supersededAt: 'desc' },
        });
        if (supersededFinal) {
          const [supplementTask, activeSupplement] = await Promise.all([
            tx.reviewTask.findFirst({
              where: { applicationId, status: ReviewTaskStatus.supplement_required },
              select: { id: true },
            }),
            tx.supplementRequest.findFirst({
              where: {
                applicationId,
                status: 'active',
                closedAt: null,
                resubmittedAt: null,
              },
              select: { id: true },
            }),
          ]);
          status = supplementTask || activeSupplement
            ? ApplicationStatus.supplement_required
            : ApplicationStatus.under_review;
        }
      }

      const wasArchived = application.archivedAt !== null;
      const updated = await tx.application.update({
        where: { id: applicationId },
        data: {
          status,
          cancelledAt: null,
          cancelledById: null,
          cancelReason: null,
          ...(wasArchived
            ? { archivedAt: null, archivedById: null, archiveReason: null }
            : {}),
        },
      });
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.APPLICATION_CANCELLED_REOPENED,
        targetType: 'application',
        targetId: applicationId,
        applicationId,
        workspaceId: application.workspaceId,
        beforeStateJson: lifecycleState(application),
        afterStateJson: lifecycleState(updated),
        note: input.reason,
      });
      if (wasArchived) {
        await createApplicationAudit(tx, {
          actorId: user.id,
          actorRole: user.role,
          action: auditActions.APPLICATION_UNARCHIVED,
          targetType: 'application',
          targetId: applicationId,
          applicationId,
          workspaceId: application.workspaceId,
          beforeStateJson: { archivedAt: application.archivedAt?.toISOString() ?? null },
          afterStateJson: { archivedAt: null },
          note: input.reason,
        });
      }
      await tx.notification.create({
        data: {
          userId: application.studentId,
          workspaceId: application.workspaceId,
          applicationId,
          type: NotificationType.application_updated,
          title: 'Hồ sơ được mở lại',
          message: 'Hồ sơ của bạn đã được mở lại để tiếp tục xét duyệt.',
        },
      });

      return updated;
    });
  }

  async archive(user: AuthenticatedUser, applicationId: string, input: ArchiveApplicationInput) {
    const scoped = await this.findScopedCityApplication(user, applicationId);

    return prisma.$transaction(async (tx) => {
      const application = await this.lockAndRead(tx, scoped.id);
      if (application.archivedAt) throw lifecycleConflict('Application is already archived');
      const terminal =
        application.status === ApplicationStatus.completed ||
        application.status === ApplicationStatus.rejected;
      if (!terminal && !application.cancelledAt) {
        throw lifecycleConflict('Only terminal or cancelled applications can be archived');
      }

      const updated = await tx.application.update({
        where: { id: applicationId },
        data: {
          archivedAt: new Date(),
          archivedById: user.id,
          archiveReason: input.reason ?? null,
        },
      });
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.APPLICATION_ARCHIVED,
        targetType: 'application',
        targetId: applicationId,
        applicationId,
        workspaceId: application.workspaceId,
        beforeStateJson: lifecycleState(application),
        afterStateJson: lifecycleState(updated),
        note: input.reason,
      });
      return updated;
    });
  }

  async unarchive(user: AuthenticatedUser, applicationId: string) {
    const scoped = await this.findScopedCityApplication(user, applicationId);

    return prisma.$transaction(async (tx) => {
      const application = await this.lockAndRead(tx, scoped.id);
      if (!application.archivedAt) throw lifecycleConflict('Application is not archived');

      const updated = await tx.application.update({
        where: { id: applicationId },
        data: { archivedAt: null, archivedById: null, archiveReason: null },
      });
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.APPLICATION_UNARCHIVED,
        targetType: 'application',
        targetId: applicationId,
        applicationId,
        workspaceId: application.workspaceId,
        beforeStateJson: lifecycleState(application),
        afterStateJson: lifecycleState(updated),
      });
      return updated;
    });
  }

  private async findScopedCityApplication(user: AuthenticatedUser, applicationId: string) {
    this.assertLifecycleRole(user);
    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      include: scopedApplicationInclude,
    });
    if (!application) {
      throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
    }

    assertReviewWorkspaceAccess(
      user,
      {
        workspaceId: application.workspaceId,
        workspaceType: application.workspace.type,
        workspaceIsActive: application.workspace.isActive,
      },
      'Application not found',
    );
    if (
      application.applicationType !== ApplicationType.individual ||
      application.targetLevel !== 'city' ||
      application.workspace.type !== WorkspaceType.SCHOOL ||
      !application.workspace.isActive
    ) {
      throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
    }
    return application;
  }

  private assertLifecycleRole(user: AuthenticatedUser) {
    if (user.role !== Role.city_manager && user.role !== Role.admin) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Only City Managers and admins may manage applications');
    }
  }

  private async lockAndRead(tx: Prisma.TransactionClient, applicationId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Application" WHERE "id" = ${applicationId}::uuid FOR UPDATE
    `;
    if (rows.length !== 1) {
      throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
    }
    const application = await tx.application.findUnique({
      where: { id: applicationId },
      include: scopedApplicationInclude,
    });
    if (!application) {
      throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
    }
    return application;
  }
}

function hasCurrentFinal(application: {
  finalizedAt: Date | null;
  finalStatus: FinalStatus;
}) {
  return application.finalizedAt !== null || application.finalStatus !== FinalStatus.pending;
}

function finalDecisionState(application: {
  finalStatus: FinalStatus;
  finalLevel: string | null;
  finalNote: string | null;
  finalizedAt: Date | null;
  finalizedById: string | null;
}) {
  return {
    finalStatus: application.finalStatus,
    finalLevel: application.finalLevel,
    finalNote: application.finalNote,
    finalizedAt: application.finalizedAt?.toISOString() ?? null,
    finalizedById: application.finalizedById,
  };
}

function lifecycleState(application: {
  status: ApplicationStatus;
  finalStatus: FinalStatus;
  cancelledAt: Date | null;
  cancelledById: string | null;
  cancelReason: string | null;
  archivedAt: Date | null;
  archivedById: string | null;
  archiveReason: string | null;
  finalLevel: string | null;
  finalNote: string | null;
  finalizedAt: Date | null;
  finalizedById: string | null;
}) {
  return {
    status: application.status,
    ...finalDecisionState(application),
    cancelledAt: application.cancelledAt?.toISOString() ?? null,
    cancelledById: application.cancelledById,
    cancelReason: application.cancelReason,
    archivedAt: application.archivedAt?.toISOString() ?? null,
    archivedById: application.archivedById,
    archiveReason: application.archiveReason,
  };
}

function lifecycleConflict(message: string) {
  return new AppError(409, ErrorCodes.APPLICATION_LOCKED, message);
}

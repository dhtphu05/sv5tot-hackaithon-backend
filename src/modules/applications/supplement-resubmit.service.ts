import {
  ApplicationStatus,
  ApplicationType,
  Criterion,
  EvidenceStatus,
  IndexingStatus,
  Level,
  NotificationType,
  Prisma,
  ReviewTaskStatus,
  Role,
  type PrismaClient,
} from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { auditActions } from '../../shared/constants/application';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { NotificationsService } from '../notifications/notifications.service';
import { CityReviewSeasonsService } from '../manager/city-review-seasons.service';
import { createApplicationAudit } from './application.helpers';
import {
  assertApplicationNotCancelled,
  lockApplicationAndAssertNotCancelled,
} from './application-lifecycle.policy';

const activeProcessingStatuses = new Set<IndexingStatus>([
  IndexingStatus.pending_indexing,
  IndexingStatus.ocr_processing,
  IndexingStatus.extracting,
  IndexingStatus.checking_registry,
]);

const supplementTaskInclude = Prisma.validator<Prisma.ReviewTaskInclude>()({
  supplementRequests: { orderBy: { createdAt: 'desc' } },
  application: {
    include: {
      student: true,
      evidences: {
        include: { evidenceCard: true },
        orderBy: { updatedAt: 'desc' },
      },
    },
  },
});

type SupplementTaskRecord = Prisma.ReviewTaskGetPayload<{
  include: typeof supplementTaskInclude;
}>;

export class SupplementResubmitService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly notificationsService = new NotificationsService(),
  ) {}

  async resubmit(user: AuthenticatedUser, reviewTaskId: string) {
    assertStudentOnly(user);
    const initialTask = await this.getOwnedSupplementTask(this.db, user, reviewTaskId);
    assertApplicationNotCancelled(initialTask.application!);

    return this.db.$transaction(async (tx) => {
      await lockApplicationAndAssertNotCancelled(tx, initialTask.applicationId!);
      const task = await this.getOwnedSupplementTask(tx, user, reviewTaskId);
      const application = task.application!;
      const request = activeSupplementRequest(task);
      if (!request) {
        throw new AppError(
          404,
          ErrorCodes.STUDENT_ASSISTANT_CONTEXT_NOT_FOUND,
          'Active supplement request not found',
        );
      }

      if (
        application.applicationType === ApplicationType.individual &&
        application.targetLevel === Level.city
      ) {
        await CityReviewSeasonsService.assertSupplementResubmissionBeforeDeadline(tx, application);
      }

      const readiness = evaluateSupplementReadiness(task);
      if (!readiness.canResubmit) {
        throw new AppError(
          409,
          ErrorCodes.SUPPLEMENT_NOT_READY_TO_RESUBMIT,
          readiness.reason ?? 'Supplement is not ready to resubmit',
        );
      }

      const now = new Date();
      const evidenceLinks = application.evidences
        .filter((evidence) => evidence.criterion === task.criterion)
        .map((evidence) => ({ reviewTaskId: task.id, evidenceId: evidence.id }));
      if (evidenceLinks.length > 0) {
        await tx.reviewTaskEvidence.createMany({ data: evidenceLinks, skipDuplicates: true });
      }

      const durableRequest =
        request.id === 'legacy'
          ? await tx.supplementRequest.create({
              data: {
                workspaceId: task.workspaceId,
                applicationId: task.applicationId!,
                reviewTaskId: task.id,
                criterion: task.criterion,
                status: 'active',
                officialMessage: request.officialMessage,
                requestedFieldsJson: jsonInputOrNull(request.requestedFieldsJson),
                evidenceScopeJson: jsonInputOrNull(request.evidenceScopeJson),
                acceptedEvidenceTypesJson: jsonInputOrNull(request.acceptedEvidenceTypesJson),
                deadline: request.deadline,
                createdByUserId: null,
                historyJson: appendHistory(request.historyJson, {
                  at: now.toISOString(),
                  actorId: user.id,
                  action: 'legacy_request_migrated_for_resubmit',
                }),
              },
            })
          : request;

      const updatedRequest = await tx.supplementRequest.update({
        where: { id: durableRequest.id },
        data: {
          status: 'resubmitted',
          resubmittedAt: now,
          historyJson: appendHistory(durableRequest.historyJson, {
            at: now.toISOString(),
            actorId: user.id,
            action: 'student_resubmitted',
          }),
        },
      });

      const taskUpdate = await tx.reviewTask.updateMany({
        where: {
          id: task.id,
          applicationId: task.applicationId!,
          status: ReviewTaskStatus.supplement_required,
        },
        data: {
          status: ReviewTaskStatus.waiting,
          decision: null,
          officerNote: null,
          officerSuggestedLevel: null,
          levelAssessmentJson: Prisma.JsonNull,
          decisionReason: null,
        },
      });
      if (taskUpdate.count !== 1) {
        throw new AppError(
          409,
          ErrorCodes.APPLICATION_LOCKED,
          'Yêu cầu bổ sung đã thay đổi. Vui lòng tải lại trước khi gửi.',
        );
      }

      const remainingSupplementTasks = await tx.reviewTask.count({
        where: {
          applicationId: task.applicationId!,
          status: ReviewTaskStatus.supplement_required,
        },
      });
      const applicationStatus =
        remainingSupplementTasks > 0
          ? ApplicationStatus.supplement_required
          : ApplicationStatus.under_review;

      await tx.application.update({
        where: { id: task.applicationId! },
        data: { status: applicationStatus },
      });

      await tx.evidence.updateMany({
        where: {
          applicationId: task.applicationId!,
          criterion: task.criterion,
          status: {
            in: [
              EvidenceStatus.draft,
              EvidenceStatus.pending_indexing,
              EvidenceStatus.indexed,
              EvidenceStatus.needs_supplement,
            ],
          },
        },
        data: { status: EvidenceStatus.under_review },
      });

      if (task.assignedOfficerId) {
        await this.notificationsService.create(
          {
            userId: task.assignedOfficerId,
            workspaceId: task.workspaceId,
            applicationId: task.applicationId,
            reviewTaskId: task.id,
            type: NotificationType.review_updated,
            title: 'Sinh viên đã gửi lại bổ sung',
            message: `Sinh viên đã gửi lại bổ sung cho tiêu chí ${criterionLabel(task.criterion)}.`,
            metadata: {
              supplementRequestId: durableRequest.id,
              criterion: task.criterion,
            },
          },
          tx,
        );
      }

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.SUPPLEMENT_RESUBMITTED,
        targetType: 'supplement_request',
        targetId: durableRequest.id,
        applicationId: task.applicationId,
        workspaceId: task.workspaceId,
        afterStateJson: {
          reviewTaskId: task.id,
          criterion: task.criterion,
          status: updatedRequest.status,
          resubmittedAt: now.toISOString(),
          linkedEvidenceCount: evidenceLinks.length,
          applicationStatus,
        },
      });

      return {
        supplementRequest: {
          id: updatedRequest.id,
          status: updatedRequest.status,
          resubmittedAt: updatedRequest.resubmittedAt?.toISOString() ?? null,
        },
        reviewTask: { id: task.id, status: ReviewTaskStatus.waiting },
        application: { id: task.applicationId, status: applicationStatus },
      };
    });
  }

  private async getOwnedSupplementTask(
    db: Pick<PrismaClient, 'reviewTask'> | Prisma.TransactionClient,
    user: AuthenticatedUser,
    reviewTaskId: string,
  ): Promise<SupplementTaskRecord> {
    const task = await db.reviewTask.findUnique({
      where: { id: reviewTaskId },
      include: supplementTaskInclude,
    });
    if (!task || !task.application || task.application.studentId !== user.id) {
      throw new AppError(404, ErrorCodes.STUDENT_ASSISTANT_CONTEXT_NOT_FOUND, 'Supplement request not found');
    }
    if (task.status !== ReviewTaskStatus.supplement_required) {
      throw new AppError(
        404,
        ErrorCodes.STUDENT_ASSISTANT_CONTEXT_NOT_FOUND,
        'Active supplement request not found',
      );
    }
    return task;
  }
}

function assertStudentOnly(user: AuthenticatedUser): void {
  if (user.role !== Role.student) {
    throw new AppError(403, ErrorCodes.FORBIDDEN, 'Student access required');
  }
}

function activeSupplementRequest(task: SupplementTaskRecord) {
  const active = task.supplementRequests.find((request) => request.status === 'active');
  if (active) return active;

  const legacy = asRecord(task.supplementRequestJson);
  const reason =
    stringFromRecord(legacy, 'reason') ??
    stringFromRecord(legacy, 'note') ??
    task.officerNote;
  if (!reason) return null;

  return {
    id: 'legacy',
    status: 'active',
    officialMessage: reason,
    requestedFieldsJson: legacy?.requestedFields ?? [],
    evidenceScopeJson: { evidenceIds: legacy?.evidenceIds ?? [] },
    acceptedEvidenceTypesJson: null,
    deadline: parseDate(stringFromRecord(legacy, 'deadline')) ?? task.dueDate ?? null,
    historyJson: [],
  };
}

function evaluateSupplementReadiness(task: SupplementTaskRecord) {
  if (!task.application || task.application.status !== ApplicationStatus.supplement_required) {
    return { canResubmit: false, reason: 'Hồ sơ không ở trạng thái cần bổ sung.' };
  }
  const evidences = task.application.evidences.filter(
    (evidence) => evidence.criterion === task.criterion,
  );
  if (evidences.length === 0) {
    return { canResubmit: false, reason: 'Bạn chưa có minh chứng cho tiêu chí này.' };
  }
  if (evidences.some((evidence) => activeProcessingStatuses.has(evidence.indexingStatus))) {
    return { canResubmit: false, reason: 'Có minh chứng đang được xử lý, cần chờ hoàn tất.' };
  }
  if (
    evidences.some(
      (evidence) =>
        evidence.evidenceCard?.requiresHumanConfirmation ||
        evidence.evidenceCard?.confirmationStatus === 'pending' ||
        evidence.evidenceCard?.confirmationStatus === 'correction_required',
    )
  ) {
    return { canResubmit: false, reason: 'Có minh chứng cần bạn xác nhận thông tin trước.' };
  }
  if (
    !evidences.some(
      (evidence) =>
        evidence.status === EvidenceStatus.indexed ||
        evidence.status === EvidenceStatus.needs_supplement ||
        evidence.status === EvidenceStatus.under_review,
    )
  ) {
    return { canResubmit: false, reason: 'Chưa có minh chứng đã sẵn sàng cho yêu cầu bổ sung.' };
  }
  if (task.dueDate && task.dueDate.getTime() < Date.now()) {
    return { canResubmit: false, reason: 'Yêu cầu bổ sung đã quá hạn, bạn cần liên hệ cán bộ.' };
  }
  return { canResubmit: true, reason: null };
}

function jsonInputOrNull(value: Prisma.JsonValue | null | undefined): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null || value === undefined
    ? Prisma.JsonNull
    : (value as Prisma.InputJsonValue);
}

function appendHistory(history: Prisma.JsonValue | null, item: Record<string, unknown>) {
  const current = Array.isArray(history) ? history : [];
  return [...current, item] as Prisma.InputJsonValue;
}

function asRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> | null {
  if (!value || Array.isArray(value) || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function stringFromRecord(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function criterionLabel(criterion: Criterion): string {
  const labels: Partial<Record<Criterion, string>> = {
    [Criterion.ethics]: 'Đạo đức tốt',
    [Criterion.academic]: 'Học tập tốt',
    [Criterion.physical]: 'Thể lực tốt',
    [Criterion.volunteer]: 'Tình nguyện tốt',
    [Criterion.integration]: 'Hội nhập tốt',
  };
  return labels[criterion] ?? criterion;
}

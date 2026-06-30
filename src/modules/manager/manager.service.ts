// Owns management dashboards, workload views, and review assignment.
import {
  ApplicationStatus,
  FinalStatus,
  NotificationType,
  Role,
  ReviewTaskStatus,
  type Prisma,
} from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { auditActions } from '../../shared/constants/application';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { createApplicationAudit } from '../applications/application.helpers';
import { buildReviewProgress } from '../review/review-progress.service';
import type {
  AssignReviewTaskInput,
  FinalizeApplicationInput,
  ListManagerApplicationsQuery,
  ReopenFinalInput,
} from './manager.validation';

export class ManagerService {
  async listApplications(query: ListManagerApplicationsQuery) {
    const where: Prisma.ApplicationWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.targetLevel ? { targetLevel: query.targetLevel } : {}),
      ...(query.schoolYear ? { schoolYear: query.schoolYear } : {}),
      ...(query.faculty ? { student: { faculty: query.faculty } } : {}),
      ...(query.q
        ? {
            OR: [
              { student: { fullName: { contains: query.q, mode: 'insensitive' } } },
              { student: { studentCode: { contains: query.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const skip = (query.page - 1) * query.limit;
    const [applications, total] = await prisma.$transaction([
      prisma.application.findMany({
        where,
        include: { student: true, reviewTasks: { select: { status: true } } },
        orderBy: { submittedAt: 'desc' },
        skip,
        take: query.limit,
      }),
      prisma.application.count({ where }),
    ]);

    return {
      items: applications.map((application) => ({
        id: application.id,
        student: application.student,
        schoolYear: application.schoolYear,
        targetLevel: application.targetLevel,
        status: application.status,
        readinessScore: application.readinessScore,
        submittedAt: application.submittedAt,
        reviewProgress: buildReviewProgress(application.reviewTasks.map((task) => task.status)),
      })),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async getWorkloads() {
    const officers = await prisma.user.findMany({
      where: { role: Role.officer, isActive: true },
      include: {
        officerSpecializations: { where: { isActive: true } },
        assignedReviewTasks: {
          where: {
            status: {
              in: [
                ReviewTaskStatus.waiting,
                ReviewTaskStatus.reviewing,
                ReviewTaskStatus.supplement_required,
                ReviewTaskStatus.resolution_needed,
              ],
            },
          },
          select: { status: true },
        },
      },
      orderBy: { fullName: 'asc' },
    });

    return {
      officers: officers.map((officer) => {
        const progress = buildReviewProgress(
          officer.assignedReviewTasks.map((task) => task.status),
        );
        return {
          id: officer.id,
          fullName: officer.fullName,
          specializations: officer.officerSpecializations.map((item) => item.criterion),
          facultyScope: officer.officerSpecializations[0]?.facultyScope ?? null,
          workload: {
            waiting: progress.waiting,
            reviewing: progress.reviewing,
            supplementRequired: progress.supplementRequired,
            resolutionNeeded: progress.resolutionNeeded,
            totalActive:
              progress.waiting +
              progress.reviewing +
              progress.supplementRequired +
              progress.resolutionNeeded,
          },
        };
      }),
    };
  }

  async assignTask(user: AuthenticatedUser, taskId: string, input: AssignReviewTaskInput) {
    const [task, officer] = await Promise.all([
      prisma.reviewTask.findUnique({
        where: { id: taskId },
        include: {
          application: { include: { student: true } },
          collectiveProfile: { include: { representative: true } },
        },
      }),
      prisma.user.findUnique({
        where: { id: input.officerId },
        include: { officerSpecializations: true },
      }),
    ]);

    if (!task) {
      throw new AppError(404, ErrorCodes.REVIEW_TASK_NOT_FOUND, 'Review task not found');
    }
    if (!officer || officer.role !== Role.officer || !officer.isActive) {
      throw new AppError(404, ErrorCodes.OFFICER_NOT_FOUND, 'Officer not found');
    }

    const specialized = officer.officerSpecializations.some(
      (item) =>
        item.isActive &&
        item.criterion === task.criterion &&
        (!item.facultyScope ||
          item.facultyScope ===
            (task.application?.student.faculty ?? task.collectiveProfile?.representative.faculty)),
    );
    if (!specialized && !input.note) {
      throw new AppError(
        409,
        ErrorCodes.OFFICER_NOT_SPECIALIZED,
        'Officer is not specialized for this task. Provide note to override.',
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.reviewTask.update({
        where: { id: task.id },
        data: { assignedOfficerId: officer.id },
        include: { assignedOfficer: true, application: true },
      });
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.REVIEW_TASK_REASSIGNED,
        targetType: 'review_task',
        targetId: task.id,
        applicationId: task.applicationId,
        collectiveProfileId: task.collectiveProfileId,
        beforeStateJson: { assignedOfficerId: task.assignedOfficerId },
        afterStateJson: { assignedOfficerId: officer.id, override: !specialized },
        note: input.note,
      });
      await tx.notification.create({
        data: {
          userId: officer.id,
          applicationId: task.applicationId,
          collectiveProfileId: task.collectiveProfileId,
          type: 'review_updated',
          title: 'Bạn được phân công review task',
          message: `Bạn được giao xét tiêu chí ${task.criterion}.`,
        },
      });
      return saved;
    });

    return updated;
  }

  async getAggregation(user: AuthenticatedUser, applicationId: string) {
    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        student: true,
        evidences: true,
        reviewTasks: { include: { evidences: true } },
        resolutionCases: true,
        precheckResults: { orderBy: { createdAt: 'desc' }, take: 1 },
        cascadeReviews: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!application) {
      throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
    }

    const aggregation = buildAggregation(application);
    await createApplicationAudit(prisma, {
      actorId: user.id,
      actorRole: user.role,
      action: auditActions.APPLICATION_AGGREGATED,
      targetType: 'application',
      targetId: application.id,
      applicationId: application.id,
      afterStateJson: {
        canFinalize: aggregation.canFinalize,
        suggestedFinalStatus: aggregation.suggestedFinalStatus,
        suggestedFinalLevel: aggregation.suggestedFinalLevel,
      },
    });
    return aggregation;
  }

  async finalizeApplication(
    user: AuthenticatedUser,
    applicationId: string,
    input: FinalizeApplicationInput,
  ) {
    if (
      (input.finalStatus === FinalStatus.passed ||
        input.finalStatus === FinalStatus.partially_passed) &&
      !input.finalLevel
    ) {
      throw new AppError(400, ErrorCodes.FINAL_LEVEL_REQUIRED, 'Final level is required');
    }
    if (input.overrideAggregation && user.role === Role.manager) {
      throw new AppError(
        403,
        ErrorCodes.FORBIDDEN,
        'Only committee or admin can override aggregation',
      );
    }

    const aggregation = await this.getAggregation(user, applicationId);
    if (!aggregation.canFinalize && !input.overrideAggregation) {
      throw new AppError(409, ErrorCodes.FINALIZE_BLOCKED, 'Application cannot be finalized yet', {
        blockingReasons: aggregation.blockingReasons,
      });
    }
    if (
      aggregation.application.status === ApplicationStatus.completed ||
      aggregation.application.status === ApplicationStatus.rejected
    ) {
      if (user.role !== Role.admin) {
        throw new AppError(
          409,
          ErrorCodes.FINAL_RESULT_ALREADY_EXISTS,
          'Final result already exists',
        );
      }
    }

    const status =
      input.finalStatus === FinalStatus.failed
        ? ApplicationStatus.rejected
        : ApplicationStatus.completed;

    return prisma.$transaction(async (tx) => {
      const before = await tx.application.findUniqueOrThrow({ where: { id: applicationId } });
      const updated = await tx.application.update({
        where: { id: applicationId },
        data: {
          status,
          finalStatus: input.finalStatus,
          finalLevel: input.finalStatus === FinalStatus.failed ? null : input.finalLevel,
        },
      });
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.APPLICATION_FINALIZED,
        targetType: 'application',
        targetId: applicationId,
        applicationId,
        beforeStateJson: {
          status: before.status,
          finalStatus: before.finalStatus,
          finalLevel: before.finalLevel,
        },
        afterStateJson: {
          status,
          finalStatus: input.finalStatus,
          finalLevel: updated.finalLevel,
          overrideAggregation: input.overrideAggregation,
        },
        note: input.finalNote,
      });
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.FINAL_RESULT_CONFIRMED,
        targetType: 'application',
        targetId: applicationId,
        applicationId,
        afterStateJson: {
          finalStatus: input.finalStatus,
          finalLevel: updated.finalLevel,
        },
        note: input.finalNote,
      });
      if (input.overrideAggregation) {
        await createApplicationAudit(tx, {
          actorId: user.id,
          actorRole: user.role,
          action: auditActions.FINAL_RESULT_OVERRIDDEN,
          targetType: 'application',
          targetId: applicationId,
          applicationId,
          afterStateJson: { blockingReasons: aggregation.blockingReasons },
          note: input.finalNote,
        });
      }
      if (input.notifyStudent) {
        await tx.notification.create({
          data: {
            userId: before.studentId,
            applicationId,
            type: NotificationType.result_available,
            title: 'Hồ sơ Sinh viên 5 tốt đã có kết quả',
            message: buildFinalNotificationMessage(
              input.finalStatus,
              updated.finalLevel,
              input.finalNote,
            ),
          },
        });
      }

      return {
        application: updated,
        finalResult: {
          finalStatus: updated.finalStatus,
          finalLevel: updated.finalLevel,
          finalNote: input.finalNote,
        },
      };
    });
  }

  async reopenFinal(user: AuthenticatedUser, applicationId: string, input: ReopenFinalInput) {
    const application = await prisma.application.findUnique({ where: { id: applicationId } });
    if (!application) {
      throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
    }
    if (
      application.status !== ApplicationStatus.completed &&
      application.status !== ApplicationStatus.rejected
    ) {
      return application;
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.application.update({
        where: { id: applicationId },
        data: {
          status: input.status,
          finalStatus: FinalStatus.pending,
          finalLevel: null,
        },
      });
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.FINAL_RESULT_REOPENED,
        targetType: 'application',
        targetId: applicationId,
        applicationId,
        beforeStateJson: {
          status: application.status,
          finalStatus: application.finalStatus,
          finalLevel: application.finalLevel,
        },
        afterStateJson: { status: updated.status, finalStatus: updated.finalStatus },
        note: input.reason,
      });
      await tx.notification.create({
        data: {
          userId: application.studentId,
          applicationId,
          type: NotificationType.review_updated,
          title: 'Kết quả hồ sơ được mở lại',
          message: input.reason,
        },
      });
      return updated;
    });
  }
}

type AggregationApplication = Prisma.ApplicationGetPayload<{
  include: {
    student: true;
    evidences: true;
    reviewTasks: { include: { evidences: true } };
    resolutionCases: true;
    precheckResults: true;
    cascadeReviews: true;
  };
}>;

export function buildAggregation(application: AggregationApplication) {
  const reviewProgress = buildReviewProgress(application.reviewTasks.map((task) => task.status));
  const resolutionSummary = {
    open: application.resolutionCases.filter(
      (item) => item.status === 'open' || item.status === 'in_review',
    ).length,
    resolved: application.resolutionCases.filter((item) => item.status === 'resolved').length,
    rejected: application.resolutionCases.filter((item) => item.status === 'rejected').length,
  };
  const criteriaSummary = application.reviewTasks.map((task) => {
    const hasResolutionOpen = application.resolutionCases.some(
      (item) =>
        (item.status === 'open' || item.status === 'in_review') &&
        task.evidences.some((evidence) => evidence.evidenceId === item.evidenceId),
    );
    return {
      criterion: task.criterion,
      taskStatus: task.status,
      decision: task.decision,
      evidenceCount: task.evidences.length,
      hasResolutionOpen,
      blocking:
        hasResolutionOpen ||
        task.status === ReviewTaskStatus.waiting ||
        task.status === ReviewTaskStatus.reviewing ||
        task.status === ReviewTaskStatus.supplement_required ||
        task.status === ReviewTaskStatus.resolution_needed ||
        task.status === ReviewTaskStatus.rejected,
      summary: buildCriterionSummary(task.status),
    };
  });
  const blockingReasons = [
    ...(reviewProgress.waiting > 0 ? ['Còn task đang chờ xét.'] : []),
    ...(reviewProgress.reviewing > 0 ? ['Còn task đang được xét.'] : []),
    ...(reviewProgress.supplementRequired > 0 ? ['Còn task yêu cầu bổ sung.'] : []),
    ...(resolutionSummary.open > 0 ? ['Còn resolution case chưa xử lý.'] : []),
  ];
  const allCoreAccepted = criteriaSummary
    .filter((item) => item.criterion !== 'priority')
    .every((item) => item.taskStatus === ReviewTaskStatus.accepted);
  const hasRejected = criteriaSummary.some((item) => item.taskStatus === ReviewTaskStatus.rejected);
  const latestCascade = application.cascadeReviews[0] ?? null;
  const suggestedFinalStatus = allCoreAccepted
    ? FinalStatus.passed
    : hasRejected
      ? FinalStatus.failed
      : latestCascade?.suggestedLevel && latestCascade.suggestedLevel !== application.targetLevel
        ? FinalStatus.partially_passed
        : FinalStatus.pending;

  return {
    application: {
      id: application.id,
      targetLevel: application.targetLevel,
      status: application.status,
      finalStatus: application.finalStatus,
      finalLevel: application.finalLevel,
      readinessScore: application.readinessScore,
    },
    student: application.student,
    criteriaSummary,
    reviewProgress,
    resolutionSummary,
    suggestedFinalStatus,
    suggestedFinalLevel:
      suggestedFinalStatus === FinalStatus.failed
        ? null
        : (latestCascade?.suggestedLevel ?? application.targetLevel),
    canFinalize: reviewProgress.canAggregate && resolutionSummary.open === 0,
    blockingReasons,
    warnings: ['Kết quả tổng hợp là gợi ý, Hội đồng cần xác nhận trước khi chốt.'],
    latestPrecheck: application.precheckResults[0] ?? null,
    latestCascade,
  };
}

function buildCriterionSummary(status: ReviewTaskStatus): string {
  if (status === ReviewTaskStatus.accepted) return 'Tiêu chí đã được cán bộ xác nhận.';
  if (status === ReviewTaskStatus.rejected)
    return 'Tiêu chí bị từ chối, cần Hội đồng xem xét khi chốt.';
  if (status === ReviewTaskStatus.supplement_required) return 'Tiêu chí đang yêu cầu bổ sung.';
  if (status === ReviewTaskStatus.resolution_needed) return 'Tiêu chí cần xử lý ở Resolution Hub.';
  return 'Tiêu chí chưa hoàn tất xét duyệt.';
}

function buildFinalNotificationMessage(
  status: FinalStatus,
  level: string | null,
  note: string,
): string {
  if (status === FinalStatus.passed) {
    return `Hồ sơ Sinh viên 5 tốt của bạn đã có kết quả: đạt cấp ${level}. Vui lòng xem chi tiết trong hệ thống.`;
  }
  if (status === FinalStatus.failed) {
    return `Hồ sơ Sinh viên 5 tốt của bạn đã có kết quả: chưa đạt. ${note}`;
  }
  return `Hồ sơ của bạn chưa đủ điều kiện cấp aim, nhưng được xác nhận ở cấp ${level}.`;
}

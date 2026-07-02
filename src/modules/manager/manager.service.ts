// Owns management dashboards, workload views, review assignment, and manual aggregation.
import {
  ApplicationStatus,
  Criterion,
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
  AggregateApplicationInput,
  AssignReviewTaskInput,
  FinalizeApplicationInput,
  ListManagerApplicationsQuery,
  ReopenFinalInput,
} from './manager.validation';

const applicationSummaryInclude = {
  student: true,
  evidences: { select: { id: true } },
  reviewTasks: { select: { status: true } },
} satisfies Prisma.ApplicationInclude;

const applicationDetailInclude = {
  student: true,
  metrics: true,
  evidences: {
    include: {
      evidenceFiles: { include: { file: true } },
      evidenceCard: true,
      event: true,
    },
    orderBy: { updatedAt: 'desc' },
  },
  reviewTasks: {
    include: {
      assignedOfficer: true,
      evidences: { include: { evidence: true } },
    },
    orderBy: [{ criterion: 'asc' }, { updatedAt: 'desc' }],
  },
  resolutionCases: { orderBy: { createdAt: 'desc' } },
  precheckResults: { orderBy: { createdAt: 'desc' }, take: 1 },
  cascadeReviews: { orderBy: { createdAt: 'desc' }, take: 1 },
} satisfies Prisma.ApplicationInclude;

type ApplicationDetail = Prisma.ApplicationGetPayload<{ include: typeof applicationDetailInclude }>;

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
        include: applicationSummaryInclude,
        orderBy: [{ updatedAt: 'desc' }, { submittedAt: 'desc' }],
        skip,
        take: query.limit,
      }),
      prisma.application.count({ where }),
    ]);

    return {
      items: applications.map(toApplicationSummaryItem),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async getApplicationSummary(user: AuthenticatedUser, applicationId: string) {
    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      include: applicationDetailInclude,
    });
    if (!application) {
      throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
    }

    const [notificationCount, auditTimeline] = await Promise.all([
      prisma.notification.count({ where: { applicationId } }),
      prisma.auditLog.findMany({
        where: { applicationId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);
    const aggregation = computeAggregation(application);

    await createApplicationAudit(prisma, {
      actorId: user.id,
      actorRole: user.role,
      action: 'MANAGER_APPLICATION_SUMMARY_VIEWED',
      targetType: 'application',
      targetId: application.id,
      applicationId: application.id,
      afterStateJson: { status: application.status },
    });

    return {
      application: {
        id: application.id,
        schoolYear: application.schoolYear,
        applicationType: application.applicationType,
        targetLevel: application.targetLevel,
        status: application.status,
        readinessScore: application.readinessScore,
        finalStatus: application.finalStatus,
        finalLevel: application.finalLevel,
        submittedAt: application.submittedAt,
        updatedAt: application.updatedAt,
      },
      student: pickStudent(application.student),
      metrics: application.metrics,
      evidences: groupByCriterion(application.evidences, (evidence) => evidence.criterion),
      reviewTasks: groupByCriterion(application.reviewTasks, (task) => task.criterion),
      resolutionCases: application.resolutionCases,
      notificationCount,
      auditTimeline,
      aggregation,
      latestPrecheck: application.precheckResults[0] ?? null,
      latestCascade: application.cascadeReviews[0] ?? null,
    };
  }

  async getWorkloads() {
    const [officers, unassignedTasks] = await Promise.all([
      prisma.user.findMany({
        where: { role: Role.officer, isActive: true },
        include: {
          officerSpecializations: { where: { isActive: true } },
          assignedReviewTasks: {
            select: { status: true, dueDate: true },
          },
        },
        orderBy: { fullName: 'asc' },
      }),
      prisma.reviewTask.findMany({
        where: { assignedOfficerId: null },
        select: { criterion: true, status: true, dueDate: true },
      }),
    ]);

    const unassignedByCriterion = Object.fromEntries(
      Object.values(Criterion).map((criterion) => [
        criterion,
        unassignedTasks.filter((task) => task.criterion === criterion).length,
      ]),
    );

    return {
      officers: officers.map((officer) => {
        const count = (status: ReviewTaskStatus) =>
          officer.assignedReviewTasks.filter((task) => task.status === status).length;
        const waiting = count(ReviewTaskStatus.waiting);
        const reviewing = count(ReviewTaskStatus.reviewing);
        const supplementRequired = count(ReviewTaskStatus.supplement_required);
        const resolutionNeeded = count(ReviewTaskStatus.resolution_needed);
        const overdue = officer.assignedReviewTasks.filter((task) => isTaskOverdue(task)).length;
        return {
          officerId: officer.id,
          officerName: officer.fullName,
          specializations: officer.officerSpecializations.map((item) => item.criterion),
          waiting,
          reviewing,
          supplementRequired,
          resolutionNeeded,
          accepted: count(ReviewTaskStatus.accepted),
          rejected: count(ReviewTaskStatus.rejected),
          totalOpen: waiting + reviewing + supplementRequired + resolutionNeeded,
          overdue,
        };
      }),
      unassigned: {
        total: unassignedTasks.length,
        byCriterion: unassignedByCriterion,
        overdue: unassignedTasks.filter((task) => isTaskOverdue(task)).length,
      },
    };
  }

  async assignTask(user: AuthenticatedUser, taskId: string, input: AssignReviewTaskInput) {
    return this.reassignTask(user, taskId, input);
  }

  async reassignTask(user: AuthenticatedUser, taskId: string, input: AssignReviewTaskInput) {
    const assignedOfficerId = input.assignedOfficerId ?? input.officerId;
    const reason = input.reason ?? input.note;
    if (!assignedOfficerId) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'assignedOfficerId is required');
    }

    const [task, officer] = await Promise.all([
      prisma.reviewTask.findUnique({
        where: { id: taskId },
        include: {
          application: { include: { student: true } },
          collectiveProfile: { include: { representative: true } },
        },
      }),
      prisma.user.findUnique({
        where: { id: assignedOfficerId },
        include: { officerSpecializations: { where: { isActive: true } } },
      }),
    ]);

    if (!task) {
      throw new AppError(404, ErrorCodes.REVIEW_TASK_NOT_FOUND, 'Review task not found');
    }
    if (!officer || !officer.isActive) {
      throw new AppError(404, ErrorCodes.OFFICER_NOT_FOUND, 'Officer not found');
    }
    if (
      officer.role !== Role.officer &&
      officer.role !== Role.manager &&
      officer.role !== Role.committee
    ) {
      throw new AppError(
        400,
        ErrorCodes.VALIDATION_ERROR,
        'Assigned user must be officer, manager, or committee',
      );
    }

    const faculty =
      task.application?.student.faculty ?? task.collectiveProfile?.representative.faculty ?? null;
    const specialized = isSpecializedForTask(officer.officerSpecializations, task.criterion, faculty);
    const shouldCheckSpecialization =
      officer.role === Role.officer || officer.officerSpecializations.length > 0;
    if (shouldCheckSpecialization && !specialized && !input.overrideSpecialization) {
      throw new AppError(
        400,
        ErrorCodes.VALIDATION_ERROR,
        'Officer is not specialized for this task. Set overrideSpecialization=true to override.',
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
        afterStateJson: {
          assignedOfficerId: officer.id,
          overrideSpecialization: input.overrideSpecialization,
          specialized,
        },
        note: reason,
      });
      await tx.notification.create({
        data: {
          userId: officer.id,
          applicationId: task.applicationId,
          collectiveProfileId: task.collectiveProfileId,
          type: NotificationType.review_updated,
          title: 'Bạn được phân công review task',
          message: reason
            ? `Bạn được giao xét tiêu chí ${task.criterion}. Lý do: ${reason}`
            : `Bạn được giao xét tiêu chí ${task.criterion}.`,
        },
      });
      return saved;
    });

    return { task: updated };
  }

  async getAggregation(user: AuthenticatedUser, applicationId: string) {
    const application = await this.getApplicationForAggregation(applicationId);
    const aggregation = buildAggregation(application);
    await createApplicationAudit(prisma, {
      actorId: user.id,
      actorRole: user.role,
      action: auditActions.APPLICATION_AGGREGATED,
      targetType: 'application',
      targetId: application.id,
      applicationId: application.id,
      afterStateJson: {
        allTasksDone: aggregation.allTasksDone,
        acceptedCriteria: aggregation.acceptedCriteria,
        rejectedCriteria: aggregation.rejectedCriteria,
        pendingCriteria: aggregation.pendingCriteria,
        suggestedStatus: aggregation.suggestedApplicationStatus,
      },
    });
    return aggregation;
  }

  async aggregateApplication(
    user: AuthenticatedUser,
    applicationId: string,
    input: AggregateApplicationInput,
  ) {
    const application = await this.getApplicationForAggregation(applicationId);
    const aggregation = buildAggregation(application);
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.application.update({
        where: { id: applicationId },
        data: { status: aggregation.suggestedApplicationStatus },
      });
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.APPLICATION_AGGREGATED,
        targetType: 'application',
        targetId: applicationId,
        applicationId,
        beforeStateJson: { status: application.status },
        afterStateJson: {
          status: saved.status,
          allTasksDone: aggregation.allTasksDone,
          acceptedCriteria: aggregation.acceptedCriteria,
          rejectedCriteria: aggregation.rejectedCriteria,
          pendingCriteria: aggregation.pendingCriteria,
        },
        note: input.note,
      });
      return saved;
    });

    return {
      application: updated,
      aggregation: {
        ...aggregation,
        appliedStatus: updated.status,
      },
    };
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

  private async getApplicationForAggregation(applicationId: string) {
    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      include: applicationDetailInclude,
    });
    if (!application) {
      throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
    }
    return application;
  }
}

export function buildAggregation(application: ApplicationDetail) {
  const computed = computeAggregation(application);
  const reviewProgress = buildReviewProgress(application.reviewTasks.map((task) => task.status));
  const resolutionSummary = {
    open: application.resolutionCases.filter(
      (item) => item.status === 'open' || item.status === 'in_review',
    ).length,
    resolved: application.resolutionCases.filter((item) => item.status === 'resolved').length,
    rejected: application.resolutionCases.filter((item) => item.status === 'rejected').length,
  };
  const latestCascade = application.cascadeReviews[0] ?? null;
  const suggestedFinalStatus =
    computed.allTasksDone && computed.rejectedCriteria.length === 0
      ? FinalStatus.passed
      : computed.rejectedCriteria.length > 0
        ? FinalStatus.pending
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
    student: pickStudent(application.student),
    reviewProgress,
    resolutionSummary,
    suggestedFinalStatus,
    suggestedFinalLevel:
      suggestedFinalStatus === FinalStatus.passed
        ? (latestCascade?.suggestedLevel ?? application.targetLevel)
        : null,
    canFinalize: computed.allTasksDone && resolutionSummary.open === 0,
    blockingReasons: buildBlockingReasons(reviewProgress, resolutionSummary.open),
    warnings: ['Kết quả tổng hợp là gợi ý, Hội đồng cần xác nhận trước khi chốt.'],
    latestPrecheck: application.precheckResults[0] ?? null,
    latestCascade,
    ...computed,
  };
}

function computeAggregation(application: ApplicationDetail) {
  const acceptedCriteria = uniqueCriteria(
    application.reviewTasks
      .filter((task) => task.status === ReviewTaskStatus.accepted)
      .map((task) => task.criterion),
  );
  const rejectedCriteria = uniqueCriteria(
    application.reviewTasks
      .filter((task) => task.status === ReviewTaskStatus.rejected)
      .map((task) => task.criterion),
  );
  const pendingCriteria = uniqueCriteria(
    application.reviewTasks
      .filter(
        (task) =>
          task.status === ReviewTaskStatus.waiting ||
          task.status === ReviewTaskStatus.reviewing ||
          task.status === ReviewTaskStatus.supplement_required ||
          task.status === ReviewTaskStatus.resolution_needed,
      )
      .map((task) => task.criterion),
  );
  const allTasksDone =
    application.reviewTasks.length > 0 &&
    application.reviewTasks.every(
      (task) =>
        task.status === ReviewTaskStatus.accepted || task.status === ReviewTaskStatus.rejected,
    );
  const suggestedApplicationStatus = suggestApplicationStatus(application.reviewTasks);

  return {
    allTasksDone,
    acceptedCriteria,
    rejectedCriteria,
    pendingCriteria,
    nextAction: buildNextAction(application.reviewTasks),
    suggestedApplicationStatus,
  };
}

function suggestApplicationStatus(tasks: Array<{ status: ReviewTaskStatus }>): ApplicationStatus {
  if (tasks.length === 0) return ApplicationStatus.under_review;
  if (tasks.some((task) => task.status === ReviewTaskStatus.supplement_required)) {
    return ApplicationStatus.supplement_required;
  }
  if (tasks.some((task) => task.status === ReviewTaskStatus.resolution_needed)) {
    return ApplicationStatus.resolution_needed;
  }
  if (
    tasks.some(
      (task) =>
        task.status === ReviewTaskStatus.waiting || task.status === ReviewTaskStatus.reviewing,
    )
  ) {
    return ApplicationStatus.under_review;
  }
  if (tasks.every((task) => task.status === ReviewTaskStatus.accepted)) {
    return ApplicationStatus.completed;
  }
  return ApplicationStatus.under_review;
}

function buildNextAction(tasks: Array<{ status: ReviewTaskStatus }>) {
  if (tasks.some((task) => task.status === ReviewTaskStatus.supplement_required)) {
    return 'Chờ sinh viên bổ sung minh chứng.';
  }
  if (tasks.some((task) => task.status === ReviewTaskStatus.resolution_needed)) {
    return 'Xử lý các case trong Resolution Hub.';
  }
  if (tasks.some((task) => task.status === ReviewTaskStatus.waiting)) {
    return 'Phân công hoặc mở các task đang chờ.';
  }
  if (tasks.some((task) => task.status === ReviewTaskStatus.reviewing)) {
    return 'Theo dõi cán bộ hoàn tất review.';
  }
  if (tasks.every((task) => task.status === ReviewTaskStatus.accepted)) {
    return 'Có thể chốt tổng hợp hồ sơ.';
  }
  if (tasks.some((task) => task.status === ReviewTaskStatus.rejected)) {
    return 'Xem xét tiêu chí bị từ chối trước khi chốt kết quả.';
  }
  return 'Chưa có task review để tổng hợp.';
}

function toApplicationSummaryItem(
  application: Prisma.ApplicationGetPayload<{ include: typeof applicationSummaryInclude }>,
) {
  const count = (status: ReviewTaskStatus) =>
    application.reviewTasks.filter((task) => task.status === status).length;
  return {
    id: application.id,
    student: pickStudent(application.student),
    schoolYear: application.schoolYear,
    applicationType: application.applicationType,
    targetLevel: application.targetLevel,
    status: application.status,
    evidenceCount: application.evidences.length,
    reviewTaskCount: application.reviewTasks.length,
    acceptedTaskCount: count(ReviewTaskStatus.accepted),
    rejectedTaskCount: count(ReviewTaskStatus.rejected),
    supplementTaskCount: count(ReviewTaskStatus.supplement_required),
    resolutionTaskCount: count(ReviewTaskStatus.resolution_needed),
    updatedAt: application.updatedAt.toISOString(),
  };
}

function pickStudent(student: {
  id: string;
  fullName: string;
  studentCode: string | null;
  className: string | null;
  faculty: string | null;
}) {
  return {
    id: student.id,
    fullName: student.fullName,
    studentCode: student.studentCode,
    className: student.className,
    faculty: student.faculty,
  };
}

function groupByCriterion<T>(items: T[], getCriterion: (item: T) => Criterion) {
  return Object.values(Criterion).reduce(
    (acc, criterion) => {
      acc[criterion] = items.filter((item) => getCriterion(item) === criterion);
      return acc;
    },
    {} as Record<Criterion, T[]>,
  );
}

function uniqueCriteria(criteria: Criterion[]) {
  return Array.from(new Set(criteria));
}

function buildBlockingReasons(reviewProgress: ReturnType<typeof buildReviewProgress>, openCases: number) {
  return [
    ...(reviewProgress.waiting > 0 ? ['Còn task đang chờ xét.'] : []),
    ...(reviewProgress.reviewing > 0 ? ['Còn task đang được xét.'] : []),
    ...(reviewProgress.supplementRequired > 0 ? ['Còn task yêu cầu bổ sung.'] : []),
    ...(reviewProgress.resolutionNeeded > 0 ? ['Còn task cần xử lý Resolution Hub.'] : []),
    ...(openCases > 0 ? ['Còn resolution case chưa xử lý.'] : []),
  ];
}

function isSpecializedForTask(
  specializations: Array<{ criterion: Criterion; facultyScope: string | null }>,
  criterion: Criterion,
  faculty: string | null,
) {
  return specializations.some(
    (item) =>
      item.criterion === criterion && (!item.facultyScope || item.facultyScope === faculty),
  );
}

function isTaskOverdue(task: { status: ReviewTaskStatus; dueDate: Date | null }) {
  return (
    !!task.dueDate &&
    task.dueDate.getTime() < Date.now() &&
    task.status !== ReviewTaskStatus.accepted &&
    task.status !== ReviewTaskStatus.rejected
  );
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
  return `Hồ sơ của bạn chưa đủ điều kiện cấp mục tiêu, nhưng được xác nhận ở cấp ${level}.`;
}

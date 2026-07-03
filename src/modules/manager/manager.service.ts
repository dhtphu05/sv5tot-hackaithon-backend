// Owns management dashboards, workload views, review assignment, and manual aggregation.
import {
  ApplicationStatus,
  Criterion,
  FinalStatus,
  Level,
  NotificationType,
  ResolutionStatus,
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
  ListManagerResultsQuery,
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
      evidences: {
        include: {
          evidence: {
            include: {
              evidenceFiles: { include: { file: true } },
              evidenceCard: true,
            },
          },
        },
      },
    },
    orderBy: [{ criterion: 'asc' }, { updatedAt: 'desc' }],
  },
  finalizedBy: true,
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

  async getDashboardSummary() {
    const [
      applicationStatusGroups,
      targetLevelGroups,
      finalStatusGroups,
      finalLevelGroups,
      taskStatusGroups,
      resolutionStatusGroups,
      closedResolutionCount,
      workloadOfficers,
      recentApplications,
      recentFinalizedApplications,
      totalApplications,
      unfinalizedCount,
    ] = await prisma.$transaction([
      prisma.application.groupBy({
        by: ['status'],
        orderBy: { status: 'asc' },
        _count: { _all: true },
      }),
      prisma.application.groupBy({
        by: ['targetLevel'],
        orderBy: { targetLevel: 'asc' },
        _count: { _all: true },
      }),
      prisma.application.groupBy({
        by: ['finalStatus'],
        orderBy: { finalStatus: 'asc' },
        _count: { _all: true },
      }),
      prisma.application.groupBy({
        by: ['finalLevel'],
        orderBy: { finalLevel: 'asc' },
        where: { finalLevel: { not: null } },
        _count: { _all: true },
      }),
      prisma.reviewTask.groupBy({
        by: ['status'],
        orderBy: { status: 'asc' },
        _count: { _all: true },
      }),
      prisma.resolutionCase.groupBy({
        by: ['status'],
        orderBy: { status: 'asc' },
        _count: { _all: true },
      }),
      prisma.resolutionCase.count({ where: { closedAt: { not: null } } }),
      prisma.user.findMany({
        where: { role: Role.officer, isActive: true },
        include: {
          officerSpecializations: { where: { isActive: true } },
          assignedReviewTasks: { select: { status: true } },
        },
        orderBy: { fullName: 'asc' },
      }),
      prisma.application.findMany({
        include: {
          student: true,
          reviewTasks: { select: { status: true } },
          cascadeReviews: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: [{ updatedAt: 'desc' }, { submittedAt: 'desc' }],
        take: 8,
      }),
      prisma.application.findMany({
        where: {
          OR: [
            { finalizedAt: { not: null } },
            { finalStatus: { in: [FinalStatus.passed, FinalStatus.failed, FinalStatus.partially_passed] } },
          ],
        },
        include: {
          student: true,
          finalizedBy: true,
          reviewTasks: { select: { status: true } },
          cascadeReviews: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: [{ finalizedAt: 'desc' }, { updatedAt: 'desc' }],
        take: 8,
      }),
      prisma.application.count(),
      prisma.application.count({
        where: {
          OR: [{ finalStatus: FinalStatus.pending }, { finalizedAt: null }],
        },
      }),
    ]);

    const applicationOverview = {
      totalApplications,
      draftCount: countGroup(applicationStatusGroups, ApplicationStatus.draft),
      submittedCount: countGroup(applicationStatusGroups, ApplicationStatus.submitted),
      underReviewCount: countGroup(applicationStatusGroups, ApplicationStatus.under_review),
      supplementRequiredCount: countGroup(
        applicationStatusGroups,
        ApplicationStatus.supplement_required,
      ),
      resolutionNeededCount: countGroup(applicationStatusGroups, ApplicationStatus.resolution_needed),
      completedCount: countGroup(applicationStatusGroups, ApplicationStatus.completed),
      rejectedCount: countGroup(applicationStatusGroups, ApplicationStatus.rejected),
    };
    const targetLevelBreakdown = levelCountMap(targetLevelGroups, 'targetLevel');
    const finalStatusBreakdown = {
      passed: countGroup(finalStatusGroups, FinalStatus.passed, 'finalStatus'),
      failed: countGroup(finalStatusGroups, FinalStatus.failed, 'finalStatus'),
      partiallyPassed: countGroup(finalStatusGroups, FinalStatus.partially_passed, 'finalStatus'),
      pending: countGroup(finalStatusGroups, FinalStatus.pending, 'finalStatus'),
    };
    const achievedByLevel = levelCountMap(finalLevelGroups, 'finalLevel');
    const finalLevelBreakdown = {
      ...achievedByLevel,
      notAchieved: countGroup(finalStatusGroups, FinalStatus.failed, 'finalStatus'),
      unfinalized: unfinalizedCount,
    };
    const reviewTaskSummary = buildTaskSummaryFromStatuses(taskStatusGroups);
    const resolutionSummary = {
      open: countGroup(resolutionStatusGroups, ResolutionStatus.open, 'status'),
      resolved: countGroup(resolutionStatusGroups, ResolutionStatus.resolved, 'status'),
      rejected: countGroup(resolutionStatusGroups, ResolutionStatus.rejected, 'status'),
      closed: closedResolutionCount,
    };
    const workloadByOfficer = workloadOfficers.map((officer) => {
      const waitingCount = officer.assignedReviewTasks.filter(
        (task) => task.status === ReviewTaskStatus.waiting || task.status === ReviewTaskStatus.reviewing,
      ).length;
      const completedCount = officer.assignedReviewTasks.filter(
        (task) => task.status === ReviewTaskStatus.accepted || task.status === ReviewTaskStatus.rejected,
      ).length;
      return {
        officerId: officer.id,
        fullName: officer.fullName,
        criterion: officer.officerSpecializations.map((item) => item.criterion).join(', ') || 'all',
        assignedCount: officer.assignedReviewTasks.length,
        waitingCount,
        completedCount,
      };
    });

    return {
      applicationOverview,
      targetLevelBreakdown,
      finalStatusBreakdown,
      finalLevelBreakdown,
      reviewTaskSummary,
      resolutionSummary,
      workloadByOfficer,
      recentApplications: recentApplications.map(toResultItem),
      recentFinalizedApplications: recentFinalizedApplications.map(toResultItem),

      // Backward-compatible fields for the existing analytics page.
      totalApplications: applicationOverview.totalApplications,
      submitted: applicationOverview.submittedCount,
      underReview: applicationOverview.underReviewCount,
      supplementRequired: applicationOverview.supplementRequiredCount,
      resolutionNeeded: applicationOverview.resolutionNeededCount,
      completed: applicationOverview.completedCount,
      rejected: applicationOverview.rejectedCount,
      totalReviewTasks: reviewTaskSummary.total,
      waitingTasks: reviewTaskSummary.waiting,
      reviewingTasks: countGroup(taskStatusGroups, ReviewTaskStatus.reviewing, 'status'),
      byTargetLevel: targetLevelBreakdown,
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  async listResults(query: ListManagerResultsQuery) {
    const where = buildResultsWhere(query);
    const allCandidates = await prisma.application.findMany({
      where,
      select: {
        id: true,
        targetLevel: true,
        finalStatus: true,
        readinessScore: true,
        finalizedAt: true,
        updatedAt: true,
        submittedAt: true,
        createdAt: true,
      },
    });
    const sortedCandidates = sortResultCandidates(allCandidates, query);
    const total = sortedCandidates.length;
    const skip = (query.page - 1) * query.pageSize;
    const pageIds = sortedCandidates.slice(skip, skip + query.pageSize).map((item) => item.id);
    const applications = pageIds.length
      ? await prisma.application.findMany({
          where: { id: { in: pageIds } },
          include: {
            student: true,
            finalizedBy: true,
            reviewTasks: { select: { status: true } },
            cascadeReviews: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        })
      : [];
    const orderedApplications = pageIds
      .map((id) => applications.find((application) => application.id === id))
      .filter(Boolean) as typeof applications;

    return {
      items: orderedApplications.map(toResultItem),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
      sort: {
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
      },
    };
  }

  async getResultDetail(user: AuthenticatedUser, applicationId: string) {
    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      include: applicationDetailInclude,
    });
    if (!application) {
      throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
    }

    const auditTimeline = await prisma.auditLog.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const aggregation = buildResultAggregation(application);

    await createApplicationAudit(prisma, {
      actorId: user.id,
      actorRole: user.role,
      action: 'MANAGER_RESULT_DETAIL_VIEWED',
      targetType: 'application',
      targetId: application.id,
      applicationId: application.id,
      afterStateJson: { status: application.status, finalStatus: application.finalStatus },
    });

    return {
      application: {
        id: application.id,
        schoolYear: application.schoolYear,
        applicationType: application.applicationType,
        targetLevel: application.targetLevel,
        status: application.status,
        readinessScore: application.readinessScore,
        submittedAt: application.submittedAt?.toISOString() ?? null,
        finalStatus: application.finalStatus,
        finalLevel: application.finalLevel,
        finalNote: application.finalNote,
        finalizedAt: application.finalizedAt?.toISOString() ?? null,
        updatedAt: application.updatedAt.toISOString(),
        lastActivityAt: getLastActivityAt(application).toISOString(),
        finalizedBy: application.finalizedBy
          ? { id: application.finalizedBy.id, fullName: application.finalizedBy.fullName }
          : null,
      },
      student: pickStudent(application.student),
      metrics: application.metrics.map((metric) => ({
        id: metric.id,
        metricType: metric.metricType,
        value: metric.value,
        scale: metric.scale,
        verificationStatus: metric.verificationStatus,
      })),
      reviewTasks: application.reviewTasks.map(toResultReviewTask),
      applicationEvidences: application.evidences.map(toResultEvidence),
      criterionSummary: buildCriterionSummary(application),
      latestPrecheck: application.precheckResults[0] ?? null,
      latestCascade: application.cascadeReviews[0] ?? null,
      resolutionCases: application.resolutionCases.map((item) => ({
        id: item.id,
        status: item.status,
        reason: item.reason,
        committeeDecision: item.committeeDecision,
        evidenceId: item.evidenceId,
        createdBy: { id: item.createdBy, fullName: item.createdBy },
        closedBy: item.closedBy ? { id: item.closedBy, fullName: item.closedBy } : null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: (item.closedAt ?? item.createdAt).toISOString(),
      })),
      auditTimeline: auditTimeline.map(toAuditTimelineItem),
      aggregation,
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
    if (user.role !== Role.committee && user.role !== Role.admin) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Only committee or admin can finalize results');
    }
    if (
      (input.finalStatus === FinalStatus.passed ||
        input.finalStatus === FinalStatus.partially_passed) &&
      !input.finalLevel
    ) {
      throw new AppError(400, ErrorCodes.FINAL_LEVEL_REQUIRED, 'Final level is required');
    }
    if (input.finalStatus === FinalStatus.failed && input.finalLevel) {
      throw new AppError(
        400,
        ErrorCodes.VALIDATION_ERROR,
        'Final level must be null when final status is failed',
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
          finalNote: input.finalNote,
          finalizedAt: new Date(),
          finalizedById: user.id,
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
          finalNote: before.finalNote,
        },
        afterStateJson: {
          status,
          finalStatus: input.finalStatus,
          finalLevel: updated.finalLevel,
          finalNote: updated.finalNote,
          finalizedAt: updated.finalizedAt,
          finalizedById: updated.finalizedById,
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
          finalNote: updated.finalNote,
          finalizedAt: updated.finalizedAt,
          finalizedById: updated.finalizedById,
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
          finalNote: null,
          finalizedAt: null,
          finalizedById: null,
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

function buildResultsWhere(query: ListManagerResultsQuery): Prisma.ApplicationWhereInput {
  const and: Prisma.ApplicationWhereInput[] = [];
  if (query.schoolYear) and.push({ schoolYear: query.schoolYear });
  if (query.targetLevel) and.push({ targetLevel: query.targetLevel });
  if (query.finalLevel) and.push({ finalLevel: query.finalLevel });
  if (query.finalStatus) {
    and.push(
      query.finalStatus === FinalStatus.pending || query.finalStatus === 'unfinalized'
        ? { OR: [{ finalStatus: FinalStatus.pending }, { finalizedAt: null }] }
        : { finalStatus: query.finalStatus },
    );
  }
  if (query.faculty) and.push({ student: { faculty: query.faculty } });
  if (query.className) and.push({ student: { className: query.className } });
  if (query.search) {
    and.push({
      OR: [
        { student: { fullName: { contains: query.search, mode: 'insensitive' } } },
        { student: { studentCode: { contains: query.search, mode: 'insensitive' } } },
        { student: { className: { contains: query.search, mode: 'insensitive' } } },
        { student: { faculty: { contains: query.search, mode: 'insensitive' } } },
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

function sortResultCandidates<T extends {
  targetLevel: Level;
  finalStatus: FinalStatus;
  readinessScore: number;
  finalizedAt: Date | null;
  updatedAt: Date;
  submittedAt: Date | null;
  createdAt: Date;
}>(items: T[], query: ListManagerResultsQuery) {
  const direction = query.sortBy === 'oldest' ? 'asc' : query.sortOrder;
  const factor = direction === 'asc' ? 1 : -1;
  const levelRank: Record<Level, number> = {
    school: 1,
    university: 2,
    city: 3,
    central: 4,
  };

  return [...items].sort((a, b) => {
    if (query.sortBy === 'readiness_desc') {
      return b.readinessScore - a.readinessScore || compareDates(getLastActivityAt(b), getLastActivityAt(a));
    }
    if (query.sortBy === 'unfinalized_first') {
      const aPending = a.finalStatus === FinalStatus.pending || !a.finalizedAt ? 0 : 1;
      const bPending = b.finalStatus === FinalStatus.pending || !b.finalizedAt ? 0 : 1;
      return aPending - bPending || compareDates(getLastActivityAt(b), getLastActivityAt(a));
    }
    if (query.sortBy === 'target_level_desc') {
      return levelRank[b.targetLevel] - levelRank[a.targetLevel] || compareDates(getLastActivityAt(b), getLastActivityAt(a));
    }
    return factor * compareDates(getLastActivityAt(a), getLastActivityAt(b));
  });
}

function compareDates(a: Date, b: Date) {
  return a.getTime() - b.getTime();
}

function getLastActivityAt(application: {
  finalizedAt?: Date | null;
  updatedAt: Date;
  submittedAt?: Date | null;
  createdAt?: Date;
}) {
  return application.finalizedAt ?? application.updatedAt ?? application.submittedAt ?? application.createdAt ?? new Date(0);
}

function toResultItem(application: {
  id: string;
  studentId: string;
  schoolYear: string;
  targetLevel: Level;
  finalStatus: FinalStatus;
  finalLevel: Level | null;
  finalNote?: string | null;
  status: ApplicationStatus;
  readinessScore: number;
  submittedAt: Date | null;
  finalizedAt?: Date | null;
  updatedAt: Date;
  createdAt: Date;
  finalizedBy?: { id: string; fullName: string } | null;
  student: {
    id: string;
    fullName: string;
    studentCode: string | null;
    className: string | null;
    faculty: string | null;
  };
  reviewTasks: Array<{ status: ReviewTaskStatus }>;
  cascadeReviews: Array<{ suggestedLevel: Level | null }>;
}) {
  return {
    applicationId: application.id,
    studentId: application.studentId,
    studentName: application.student.fullName,
    studentCode: application.student.studentCode,
    className: application.student.className,
    faculty: application.student.faculty,
    schoolYear: application.schoolYear,
    targetLevel: application.targetLevel,
    suggestedLevel: application.cascadeReviews[0]?.suggestedLevel ?? null,
    finalStatus: application.finalStatus,
    finalLevel: application.finalLevel,
    finalNote: application.finalNote ?? null,
    applicationStatus: application.status,
    readinessScore: application.readinessScore,
    submittedAt: application.submittedAt?.toISOString() ?? null,
    finalizedAt: application.finalizedAt?.toISOString() ?? null,
    updatedAt: application.updatedAt.toISOString(),
    lastActivityAt: getLastActivityAt(application).toISOString(),
    finalizedBy: application.finalizedBy
      ? { id: application.finalizedBy.id, fullName: application.finalizedBy.fullName }
      : null,
    reviewTaskSummary: buildTaskSummary(application.reviewTasks),
    taskProgress: {
      accepted: buildTaskSummary(application.reviewTasks).accepted,
      total: application.reviewTasks.length,
    },
  };
}

type ResultEvidenceSource =
  | ApplicationDetail['evidences'][number]
  | ApplicationDetail['reviewTasks'][number]['evidences'][number]['evidence'];

function toResultReviewTask(task: ApplicationDetail['reviewTasks'][number]) {
  return {
    id: task.id,
    criterion: task.criterion,
    status: task.status,
    decision: task.decision,
    officerNote: task.officerNote,
    officerSuggestedLevel: task.officerSuggestedLevel,
    levelAssessmentJson: task.levelAssessmentJson,
    decisionReason: task.decisionReason,
    assignedOfficer: task.assignedOfficer
      ? { id: task.assignedOfficer.id, fullName: task.assignedOfficer.fullName }
      : null,
    evidences: task.evidences.map((link) => toResultEvidence(link.evidence)),
  };
}

function toResultEvidence(evidence: ResultEvidenceSource) {
  return {
    id: evidence.id,
    evidenceName: evidence.evidenceName,
    criterion: evidence.criterion,
    sourceType: evidence.sourceType,
    status: evidence.status,
    indexingStatus: evidence.indexingStatus,
    confidence: evidence.confidence,
    files: evidence.evidenceFiles.map((link) => ({
      id: link.file.id,
      originalName: link.file.originalName,
      mimeType: link.file.mimeType,
      fileSize: link.file.fileSize,
      createdAt: link.file.createdAt.toISOString(),
    })),
    evidenceCard: evidence.evidenceCard
      ? {
          id: evidence.evidenceCard.id,
          aiSummary: evidence.evidenceCard.aiSummary,
          confidence: evidence.evidenceCard.confidence,
          ocrText: evidence.evidenceCard.ocrText,
          extractedFieldsJson: evidence.evidenceCard.extractedFieldsJson,
          warningsJson: evidence.evidenceCard.warningsJson,
          matchedEventId: evidence.evidenceCard.matchedEventId,
          matchedKnowledgeItemIds: evidence.evidenceCard.matchedKnowledgeItemIds,
        }
      : null,
  };
}

function buildCriterionSummary(application: ApplicationDetail) {
  return Object.fromEntries(
    Object.values(Criterion).map((criterion) => {
      const task = application.reviewTasks.find((item) => item.criterion === criterion);
      const evidences = application.evidences.filter((item) => item.criterion === criterion);
      const acceptedEvidenceCount = evidences.filter((item) => item.status === 'accepted').length;
      const warningCount = evidences.filter((item) => item.evidenceCard?.warningsJson).length;
      return [
        criterion,
        {
          status: task?.status ?? 'waiting',
          decision: task?.decision ?? null,
          officerSuggestedLevel: task?.officerSuggestedLevel ?? null,
          evidenceCount: evidences.length,
          acceptedEvidenceCount,
          warningCount,
          summary: buildCriterionSummaryText(task?.status, evidences.length, warningCount),
        },
      ];
    }),
  );
}

function buildCriterionSummaryText(
  status: ReviewTaskStatus | undefined,
  evidenceCount: number,
  warningCount: number,
) {
  if (!status) return evidenceCount ? 'Có minh chứng, chưa có task xét duyệt.' : 'Chưa có task xét duyệt hoặc minh chứng.';
  if (status === ReviewTaskStatus.accepted) return 'Tiêu chí đã được cán bộ chấp nhận.';
  if (status === ReviewTaskStatus.rejected) return 'Tiêu chí bị từ chối, cần xem lý do quyết định.';
  if (status === ReviewTaskStatus.supplement_required) return 'Tiêu chí đang yêu cầu sinh viên bổ sung.';
  if (status === ReviewTaskStatus.resolution_needed) return 'Tiêu chí cần hội đồng xử lý.';
  if (warningCount > 0) return 'Có cảnh báo AI cần kiểm tra.';
  return 'Tiêu chí đang chờ cán bộ xét duyệt.';
}

function buildResultAggregation(application: ApplicationDetail) {
  const aggregation = buildAggregation(application);
  const blockingIssues = [
    ...aggregation.blockingReasons.map((message) => ({
      type: 'review_progress',
      message,
      criterion: null,
    })),
    ...aggregation.pendingCriteria.map((criterion) => ({
      type: 'pending_criterion',
      message: 'Tiêu chí chưa hoàn tất xét duyệt.',
      criterion,
    })),
  ];
  return {
    suggestedFinalStatus: aggregation.suggestedFinalStatus,
    suggestedFinalLevel: aggregation.suggestedFinalLevel,
    reason: aggregation.canFinalize
      ? 'Hồ sơ đủ điều kiện để Hội đồng/Admin chốt kết quả.'
      : aggregation.blockingReasons.join(' ') || 'Hồ sơ cần kiểm tra thêm trước khi chốt.',
    canFinalize: aggregation.canFinalize,
    blockingIssues,
  };
}

function toAuditTimelineItem(item: {
  id: string;
  actorId: string | null;
  actorRole: Role | null;
  action: string;
  targetType: string;
  targetId: string;
  note: string | null;
  createdAt: Date;
}) {
  return {
    id: item.id,
    actorId: item.actorId,
    actorName: item.actorId,
    actorRole: item.actorRole,
    action: item.action,
    targetType: item.targetType,
    targetId: item.targetId,
    note: item.note,
    createdAt: item.createdAt.toISOString(),
  };
}

function buildTaskSummary(tasks: Array<{ status: ReviewTaskStatus }>) {
  const count = (status: ReviewTaskStatus) => tasks.filter((task) => task.status === status).length;
  return {
    total: tasks.length,
    accepted: count(ReviewTaskStatus.accepted),
    rejected: count(ReviewTaskStatus.rejected),
    supplementRequired: count(ReviewTaskStatus.supplement_required),
    resolutionNeeded: count(ReviewTaskStatus.resolution_needed),
    waiting: count(ReviewTaskStatus.waiting),
    reviewing: count(ReviewTaskStatus.reviewing),
  };
}

function buildTaskSummaryFromStatuses(groups: GroupCount[]) {
  return {
    total: groups.reduce((sum, group) => sum + getGroupTotal(group), 0),
    accepted: countGroup(groups, ReviewTaskStatus.accepted, 'status'),
    rejected: countGroup(groups, ReviewTaskStatus.rejected, 'status'),
    supplementRequired: countGroup(groups, ReviewTaskStatus.supplement_required, 'status'),
    resolutionNeeded: countGroup(groups, ReviewTaskStatus.resolution_needed, 'status'),
    waiting: countGroup(groups, ReviewTaskStatus.waiting, 'status'),
  };
}

type GroupCount = {
  _count?: { _all?: number } | true;
  [key: string]: unknown;
};

function levelCountMap(groups: GroupCount[], key: string) {
  return Object.values(Level).reduce(
    (acc, level) => {
      acc[level] = countGroup(groups, level, key);
      return acc;
    },
    {} as Record<Level, number>,
  );
}

function countGroup(groups: GroupCount[], value: string | null, key = 'status') {
  const match = groups.find((group) => group[key] === value);
  return match ? getGroupTotal(match) : 0;
}

function getGroupTotal(group: GroupCount) {
  return typeof group._count === 'object' ? (group._count._all ?? 0) : 0;
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

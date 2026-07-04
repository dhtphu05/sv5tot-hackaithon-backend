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
import { computeActiveCascadeSnapshot } from '../cascade/cascade.service';
import { toJsonValue } from '../rules/criteria.loader';
import { buildReviewProgress } from '../review/review-progress.service';
import type {
  AggregateApplicationInput,
  AssignReviewTaskInput,
  CommitteeInboxQuery,
  FinalizeApplicationInput,
  ListManagerApplicationsQuery,
  ListManagerResultsQuery,
  ReopenFinalInput,
} from './manager.validation';

const applicationSummaryInclude = {
  student: true,
  evidences: { select: { id: true } },
  reviewTasks: { select: { status: true } },
  resolutionCases: { select: { status: true } },
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
      dashboardCandidates,
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
          reviewTasks: { select: { status: true, dueDate: true, updatedAt: true } },
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
      prisma.application.findMany({
        select: {
          id: true,
          targetLevel: true,
          finalStatus: true,
          readinessScore: true,
          finalizedAt: true,
          updatedAt: true,
          submittedAt: true,
          createdAt: true,
          reviewTasks: { select: { status: true } },
          resolutionCases: { select: { status: true } },
          cascadeReviews: { orderBy: { createdAt: 'desc' }, take: 1, select: { suggestedLevel: true } },
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
      decisionSummary: buildDecisionSummary(dashboardCandidates),
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
        reviewTasks: { select: { status: true, dueDate: true, updatedAt: true } },
        resolutionCases: { select: { status: true } },
        cascadeReviews: { orderBy: { createdAt: 'desc' }, take: 1, select: { suggestedLevel: true } },
      },
    });
    const filteredCandidates = filterResultCandidates(allCandidates, query);
    const sortedCandidates = sortResultCandidates(filteredCandidates, query);
    const total = sortedCandidates.length;
    const skip = (query.page - 1) * query.pageSize;
    const pageIds = sortedCandidates.slice(skip, skip + query.pageSize).map((item) => item.id);
    const applications = pageIds.length
      ? await prisma.application.findMany({
          where: { id: { in: pageIds } },
          include: {
            student: true,
            finalizedBy: true,
            reviewTasks: {
              select: {
                criterion: true,
                status: true,
                officerSuggestedLevel: true,
                officerNote: true,
                decisionReason: true,
                dueDate: true,
                updatedAt: true,
                evidences: { select: { evidenceId: true } },
              },
            },
            resolutionCases: { select: { id: true, status: true, reason: true, createdAt: true } },
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

  async getCommitteeInbox(query: CommitteeInboxQuery) {
    const page = query.page;
    const limit = query.limit;
    const now = new Date();
    const applications = await prisma.application.findMany({
      where: buildCommitteeInboxWhere(query),
      include: {
        student: true,
        finalizedBy: true,
        reviewTasks: {
          select: {
            criterion: true,
            status: true,
            officerSuggestedLevel: true,
            officerNote: true,
            decisionReason: true,
            dueDate: true,
            updatedAt: true,
            evidences: { select: { evidenceId: true } },
          },
        },
        resolutionCases: {
          select: {
            id: true,
            status: true,
            reason: true,
            createdAt: true,
            closedAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        cascadeReviews: { orderBy: { createdAt: 'desc' }, take: 1, select: { suggestedLevel: true, createdAt: true } },
      },
      orderBy: [{ updatedAt: 'desc' }, { submittedAt: 'desc' }, { createdAt: 'desc' }],
    });

    const allItems = applications
      .map((application) => toCommitteeInboxItem(application, now))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    const filteredItems = allItems.filter((item) => {
      if (query.bucket !== 'all' && item.type !== query.bucket) return false;
      if (query.suggestedLevel === 'none') return item.suggestedLevel === null;
      if (query.suggestedLevel && item.suggestedLevel !== query.suggestedLevel) return false;
      return true;
    });
    const orderedItems = sortCommitteeInboxItems(filteredItems);
    const skip = (page - 1) * limit;

    return {
      summary: buildCommitteeInboxSummary(allItems),
      items: orderedItems.slice(skip, skip + limit),
      pagination: {
        page,
        limit,
        total: orderedItems.length,
        totalPages: Math.ceil(orderedItems.length / limit),
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
    if (user.role !== Role.manager && user.role !== Role.committee && user.role !== Role.admin) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Only manager, committee, or admin can finalize results');
    }
    if (input.overrideAggregation && user.role !== Role.admin) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Only admin can override finalize blockers');
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
      throw new AppError(
        409,
        ErrorCodes.FINAL_RESULT_ALREADY_EXISTS,
        'Final result already exists. Reopen the final result before finalizing again.',
      );
    }

    const applicationForCascade = await prisma.application.findUnique({
      where: { id: applicationId },
      include: applicationDetailInclude,
    });
    if (!applicationForCascade) {
      throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
    }
    const freshCascade = await computeActiveCascadeSnapshot(applicationForCascade);
    try {
      assertFinalizeMatchesCascade(input, freshCascade);
    } catch (error) {
      if (
        error instanceof AppError &&
        (error.code === ErrorCodes.FINAL_LEVEL_MISMATCH ||
          error.code === ErrorCodes.FINAL_STATUS_MISMATCH)
      ) {
        await persistFinalizeMismatchSnapshot(user, applicationId, input, aggregation, freshCascade, error);
      }
      throw error;
    }

    const status =
      input.finalStatus === FinalStatus.failed
        ? ApplicationStatus.rejected
        : ApplicationStatus.completed;

    return prisma.$transaction(async (tx) => {
      const before = await tx.application.findUniqueOrThrow({ where: { id: applicationId } });
      const cascadeReview = await tx.cascadeReview.create({
        data: {
          applicationId,
          targetLevel: freshCascade.targetLevel,
          suggestedLevel: freshCascade.suggestedLevel,
          humanConfirmationRequired: true,
          levelResultsJson: toJsonValue({
            ...freshCascade,
            latestDisplayedSuggestedLevel: aggregation.latestCascade?.suggestedLevel ?? null,
            finalizedBy: user.id,
            finalizePayload: {
              finalStatus: input.finalStatus,
              finalLevel: input.finalLevel ?? null,
            },
          }),
        },
      });
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
          cascadeSnapshot: freshCascade,
          cascadeReviewId: cascadeReview.id,
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
          cascadeSnapshot: freshCascade,
          cascadeReviewId: cascadeReview.id,
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
          cascadeSnapshot: freshCascade,
          cascadeReviewId: cascadeReview.id,
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

async function persistFinalizeMismatchSnapshot(
  user: AuthenticatedUser,
  applicationId: string,
  input: FinalizeApplicationInput,
  aggregation: Awaited<ReturnType<ManagerService['getAggregation']>>,
  freshCascade: Awaited<ReturnType<typeof computeActiveCascadeSnapshot>>,
  error: AppError,
) {
  await prisma.$transaction(async (tx) => {
    const cascadeReview = await tx.cascadeReview.create({
      data: {
        applicationId,
        targetLevel: freshCascade.targetLevel,
        suggestedLevel: freshCascade.suggestedLevel,
        humanConfirmationRequired: true,
        levelResultsJson: toJsonValue({
          ...freshCascade,
          latestDisplayedSuggestedLevel: aggregation.latestCascade?.suggestedLevel ?? null,
          finalizePayload: {
            finalStatus: input.finalStatus,
            finalLevel: input.finalLevel ?? null,
          },
          mismatchCode: error.code,
        }),
      },
    });

    await createApplicationAudit(tx, {
      actorId: user.id,
      actorRole: user.role,
      action: 'FINALIZE_CASCADE_MISMATCH',
      targetType: 'application',
      targetId: applicationId,
      applicationId,
      afterStateJson: {
        errorCode: error.code,
        cascadeSnapshot: freshCascade,
        cascadeReviewId: cascadeReview.id,
        requestedFinalStatus: input.finalStatus,
        requestedFinalLevel: input.finalLevel ?? null,
      },
      note: 'Finalization rejected because recomputed cascade no longer matched the submitted final result.',
    });
  });
}

function assertFinalizeMatchesCascade(
  input: FinalizeApplicationInput,
  freshCascade: Awaited<ReturnType<typeof computeActiveCascadeSnapshot>>,
) {
  if (!freshCascade.suggestedLevel) {
    if (input.finalStatus !== FinalStatus.failed) {
      throw new AppError(
        409,
        ErrorCodes.FINAL_STATUS_MISMATCH,
        'Final status must be failed when no active level is eligible',
        { freshCascade },
      );
    }
    if (input.finalLevel) {
      throw new AppError(
        409,
        ErrorCodes.FINAL_LEVEL_MISMATCH,
        'Final level must be null when no active level is eligible',
        { freshCascade },
      );
    }
    return;
  }

  if (input.finalStatus !== FinalStatus.passed) {
    throw new AppError(
      409,
      ErrorCodes.FINAL_STATUS_MISMATCH,
      'Final status must be passed for the recomputed suggested level',
      { freshCascade, expectedFinalStatus: FinalStatus.passed },
    );
  }
  if (input.finalLevel !== freshCascade.suggestedLevel) {
    throw new AppError(
      409,
      ErrorCodes.FINAL_LEVEL_MISMATCH,
      'Final level must match the recomputed suggested level',
      { freshCascade, expectedFinalLevel: freshCascade.suggestedLevel },
    );
  }
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

const activeCommitteeLevels = [Level.school, Level.university, Level.city];
const recentFinalizedWindowMs = 7 * 24 * 60 * 60 * 1000;
const staleWorkWindowMs = 7 * 24 * 60 * 60 * 1000;

type CommitteeInboxType =
  | 'ready_to_finalize'
  | 'downgraded'
  | 'no_eligible_level'
  | 'needs_resolution'
  | 'supplement_required'
  | 'overdue'
  | 'recently_finalized';

type CommitteeNextAction =
  | 'open_decision_console'
  | 'finalize_city'
  | 'finalize_university'
  | 'finalize_school'
  | 'finalize_failed'
  | 'open_resolution_case'
  | 'review_downgrade_reason'
  | 'wait_for_supplement'
  | 'send_reminder'
  | 'reopen_final_result';

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

function filterResultCandidates<T extends {
  targetLevel: Level;
  finalStatus: FinalStatus;
  finalizedAt: Date | null;
  updatedAt: Date;
  reviewTasks: Array<{ status: ReviewTaskStatus }>;
  resolutionCases: Array<{ status: ResolutionStatus }>;
  cascadeReviews: Array<{ suggestedLevel: Level | null }>;
}>(items: T[], query: ListManagerResultsQuery) {
  if (!query.resultView) return items;

  return items.filter((item) => {
    const progress = buildReviewProgress(item.reviewTasks.map((task) => task.status));
    const hasOpenResolution = item.resolutionCases.some((resolution) => isOpenResolutionStatus(resolution.status));
    const suggestedLevel = item.cascadeReviews[0]?.suggestedLevel ?? null;
    const finalized = isFinalizedApplication(item);
    const canFinalize = !finalized && progress.canAggregate && !hasOpenResolution;

    if (query.resultView === 'ready') return canFinalize;
    if (query.resultView === 'downgraded') return canFinalize && isDowngraded(item.targetLevel, suggestedLevel);
    if (query.resultView === 'not_eligible') return canFinalize && suggestedLevel === null;
    if (query.resultView === 'resolution') return hasOpenResolution || progress.resolutionNeeded > 0;
    if (query.resultView === 'supplement') return progress.supplementRequired > 0;
    if (query.resultView === 'overdue') return isOverdueWork(item, new Date());
    if (query.resultView === 'recently_finalized') return isRecentlyFinalized(item, new Date());
    if (query.resultView === 'unfinished') return !progress.canAggregate;
    return true;
  });
}

function buildDecisionSummary<T extends {
  targetLevel: Level;
  finalStatus: FinalStatus;
  finalizedAt: Date | null;
  updatedAt: Date;
  reviewTasks: Array<{ status: ReviewTaskStatus }>;
  resolutionCases: Array<{ status: ResolutionStatus }>;
  cascadeReviews: Array<{ suggestedLevel: Level | null }>;
}>(items: T[]) {
  const count = (resultView: NonNullable<ListManagerResultsQuery['resultView']>) =>
    filterResultCandidates(items, { resultView } as ListManagerResultsQuery).length;

  return {
    ready: count('ready'),
    downgraded: count('downgraded'),
    notEligible: count('not_eligible'),
    resolution: count('resolution'),
    supplement: count('supplement'),
    overdue: count('overdue'),
    recentlyFinalized: count('recently_finalized'),
    unfinished: count('unfinished'),
  };
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

function buildCommitteeInboxWhere(query: CommitteeInboxQuery): Prisma.ApplicationWhereInput {
  const and: Prisma.ApplicationWhereInput[] = [{ targetLevel: { in: activeCommitteeLevels } }];
  if (query.targetLevel) and.push({ targetLevel: query.targetLevel });
  if (query.status) and.push({ status: query.status });
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
  return { AND: and };
}

function isOpenResolutionStatus(status: ResolutionStatus) {
  const value = String(status);
  return (
    status === ResolutionStatus.open ||
    status === ResolutionStatus.in_review ||
    value === 'analyzing' ||
    value === 'committee_review'
  );
}

function isFinalizedApplication(application: { finalStatus: FinalStatus; finalizedAt?: Date | null }) {
  return (
    Boolean(application.finalizedAt) ||
    application.finalStatus === FinalStatus.passed ||
    application.finalStatus === FinalStatus.failed ||
    application.finalStatus === FinalStatus.partially_passed
  );
}

function isRecentlyFinalized(application: { finalStatus: FinalStatus; finalizedAt?: Date | null; updatedAt: Date }, now: Date) {
  if (!isFinalizedApplication(application)) return false;
  const finalizedAt = application.finalizedAt ?? application.updatedAt;
  return now.getTime() - finalizedAt.getTime() <= recentFinalizedWindowMs;
}

function isDowngraded(targetLevel: Level, suggestedLevel: Level | null) {
  if (!suggestedLevel) return false;
  const rank: Record<Level, number> = { school: 1, university: 2, city: 3, central: 4 };
  return rank[targetLevel] > rank[suggestedLevel];
}

function isOverdueWork(
  application: {
    finalStatus: FinalStatus;
    finalizedAt?: Date | null;
    updatedAt: Date;
    reviewTasks: Array<{ status: ReviewTaskStatus; dueDate?: Date | null; updatedAt?: Date }>;
    resolutionCases?: Array<{ status: ResolutionStatus; createdAt?: Date }>;
  },
  now: Date,
) {
  if (isFinalizedApplication(application)) return false;
  const hasOverdueTask = application.reviewTasks.some((task) => {
    if (!task.dueDate) return false;
    const openTask =
      task.status === ReviewTaskStatus.waiting ||
      task.status === ReviewTaskStatus.reviewing ||
      task.status === ReviewTaskStatus.supplement_required ||
      task.status === ReviewTaskStatus.resolution_needed;
    return openTask && task.dueDate.getTime() < now.getTime();
  });
  if (hasOverdueTask) return true;

  const hasStaleResolution = application.resolutionCases?.some(
    (resolution) =>
      isOpenResolutionStatus(resolution.status) &&
      resolution.createdAt &&
      now.getTime() - resolution.createdAt.getTime() > staleWorkWindowMs,
  );
  if (hasStaleResolution) return true;

  const progress = buildReviewProgress(application.reviewTasks.map((task) => task.status));
  return !progress.canAggregate && now.getTime() - application.updatedAt.getTime() > staleWorkWindowMs;
}

function toCommitteeInboxItem(
  application: {
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
    student: {
      id: string;
      fullName: string;
      studentCode: string | null;
      className: string | null;
      faculty: string | null;
    };
    reviewTasks: Array<{
      criterion?: Criterion;
      status: ReviewTaskStatus;
      dueDate?: Date | null;
      updatedAt?: Date;
      officerSuggestedLevel?: Level | null;
      officerNote?: string | null;
      decisionReason?: string | null;
      evidences?: Array<{ evidenceId: string }>;
    }>;
    resolutionCases: Array<{ id: string; status: ResolutionStatus; reason: string; createdAt: Date; closedAt: Date | null }>;
    cascadeReviews: Array<{ suggestedLevel: Level | null; createdAt?: Date }>;
  },
  now: Date,
) {
  const progress = buildReviewProgress(application.reviewTasks.map((task) => task.status));
  const openResolution = application.resolutionCases.find((resolution) => isOpenResolutionStatus(resolution.status));
  const suggestedLevel = application.cascadeReviews[0]?.suggestedLevel ?? null;
  const finalized = isFinalizedApplication(application);
  const canFinalize = !finalized && progress.canAggregate && !openResolution;
  const overdue = isOverdueWork(application, now);
  const type = getCommitteeInboxType({
    canFinalize,
    finalized,
    hasOpenResolution: Boolean(openResolution),
    isOverdue: overdue,
    progress,
    targetLevel: application.targetLevel,
    suggestedLevel,
    application,
    now,
  });
  if (!type) return null;

  const blockers = buildCommitteeBlockers(application, progress, openResolution ? 1 : 0);
  const nextAction = getCommitteeNextAction(type, suggestedLevel);
  const dueAt = getCommitteeDueAt(application, now);

  return {
    id: `${type}:${application.id}`,
    type,
    applicationId: application.id,
    resolutionCaseId: openResolution?.id,
    studentName: application.student.fullName,
    studentCode: application.student.studentCode,
    className: application.student.className,
    faculty: application.student.faculty,
    targetLevel: application.targetLevel,
    suggestedLevel,
    finalLevel: application.finalLevel,
    finalStatus: application.finalStatus,
    mainReason: getCommitteeMainReason(type, application.targetLevel, suggestedLevel, openResolution?.reason),
    blockers,
    nextAction,
    priority: getCommitteePriority(type),
    updatedAt: getLastActivityAt(application).toISOString(),
    dueAt: dueAt?.toISOString(),
  };
}

function getCommitteeInboxType(input: {
  canFinalize: boolean;
  finalized: boolean;
  hasOpenResolution: boolean;
  isOverdue: boolean;
  progress: ReturnType<typeof buildReviewProgress>;
  targetLevel: Level;
  suggestedLevel: Level | null;
  application: { finalStatus: FinalStatus; finalizedAt?: Date | null; updatedAt: Date };
  now: Date;
}): CommitteeInboxType | null {
  if (input.hasOpenResolution || input.progress.resolutionNeeded > 0) return 'needs_resolution';
  if (input.isOverdue) return 'overdue';
  if (!input.finalized && input.progress.supplementRequired > 0) return 'supplement_required';
  if (input.canFinalize && isDowngraded(input.targetLevel, input.suggestedLevel)) return 'downgraded';
  if (input.canFinalize && input.suggestedLevel === null) return 'no_eligible_level';
  if (input.canFinalize) return 'ready_to_finalize';
  return isRecentlyFinalized(input.application, input.now) ? 'recently_finalized' : null;
}

function getCommitteeNextAction(type: CommitteeInboxType, suggestedLevel: Level | null): CommitteeNextAction {
  if (type === 'needs_resolution') return 'open_resolution_case';
  if (type === 'overdue') return 'send_reminder';
  if (type === 'supplement_required') return 'wait_for_supplement';
  if (type === 'downgraded') return 'review_downgrade_reason';
  if (type === 'no_eligible_level') return 'finalize_failed';
  if (type === 'recently_finalized') return 'reopen_final_result';
  if (suggestedLevel === Level.city) return 'finalize_city';
  if (suggestedLevel === Level.university) return 'finalize_university';
  if (suggestedLevel === Level.school) return 'finalize_school';
  return 'finalize_failed';
}

function getCommitteePriority(type: CommitteeInboxType) {
  if (type === 'needs_resolution' || type === 'overdue') return 'high';
  if (type === 'downgraded' || type === 'no_eligible_level' || type === 'supplement_required') return 'medium';
  return 'low';
}

function getCommitteeMainReason(type: CommitteeInboxType, targetLevel: Level, suggestedLevel: Level | null, resolutionReason?: string | null) {
  if (type === 'needs_resolution') return resolutionReason || 'Có resolution case đang mở cần Hội đồng xử lý.';
  if (type === 'overdue') return 'Có task/case quá hạn hoặc hồ sơ lâu chưa được cập nhật.';
  if (type === 'supplement_required') return 'Có tiêu chí đang yêu cầu sinh viên bổ sung minh chứng.';
  if (type === 'downgraded') {
    return `Đăng ký ${getLevelLabel(targetLevel)} nhưng đề xuất mới nhất là ${getLevelLabel(suggestedLevel)}.`;
  }
  if (type === 'no_eligible_level') return 'Cascade mới nhất không đề xuất cấp đạt nào.';
  if (type === 'recently_finalized') return 'Hồ sơ đã được chốt gần đây, có thể mở lại để đối soát.';
  return 'Hồ sơ đã đủ điều kiện nghiệp vụ để Hội đồng chốt kết quả.';
}

function buildCommitteeBlockers(
  application: { reviewTasks: Array<{ criterion?: Criterion; status: ReviewTaskStatus; decisionReason?: string | null }> },
  progress: ReturnType<typeof buildReviewProgress>,
  openResolutionCases: number,
) {
  const blockers = buildBlockingReasons(progress, openResolutionCases);
  application.reviewTasks.forEach((task) => {
    if (task.status === ReviewTaskStatus.supplement_required) {
      blockers.push(`${task.criterion ?? 'criterion'} cần bổ sung minh chứng.`);
    }
    if (task.status === ReviewTaskStatus.rejected && task.decisionReason) {
      blockers.push(task.decisionReason);
    }
  });
  return [...new Set(blockers)].slice(0, 5);
}

function getCommitteeDueAt(application: { reviewTasks: Array<{ status: ReviewTaskStatus; dueDate?: Date | null }> }, now: Date) {
  const dueDates = application.reviewTasks
    .filter((task) => {
      const openTask =
        task.status === ReviewTaskStatus.waiting ||
        task.status === ReviewTaskStatus.reviewing ||
        task.status === ReviewTaskStatus.supplement_required ||
        task.status === ReviewTaskStatus.resolution_needed;
      return openTask && task.dueDate && task.dueDate.getTime() < now.getTime();
    })
    .map((task) => task.dueDate)
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => a.getTime() - b.getTime());
  return dueDates[0] ?? null;
}

function buildCommitteeInboxSummary(items: Array<{ type: CommitteeInboxType }>) {
  const count = (type: CommitteeInboxType) => items.filter((item) => item.type === type).length;
  return {
    readyToFinalize: count('ready_to_finalize'),
    downgraded: count('downgraded'),
    noEligibleLevel: count('no_eligible_level'),
    needsResolution: count('needs_resolution'),
    supplementRequired: count('supplement_required'),
    overdue: count('overdue'),
    recentlyFinalized: count('recently_finalized'),
  };
}

function sortCommitteeInboxItems<T extends { type: CommitteeInboxType; updatedAt: string; priority: string }>(items: T[]) {
  const priorityRank: Record<CommitteeInboxType, number> = {
    needs_resolution: 1,
    overdue: 2,
    supplement_required: 3,
    downgraded: 4,
    no_eligible_level: 5,
    ready_to_finalize: 6,
    recently_finalized: 7,
  };
  return [...items].sort(
    (a, b) =>
      priorityRank[a.type] - priorityRank[b.type] ||
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
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
  reviewTasks: Array<{
    criterion?: Criterion;
    status: ReviewTaskStatus;
    officerSuggestedLevel?: Level | null;
    officerNote?: string | null;
    decisionReason?: string | null;
    evidences?: Array<{ evidenceId: string }>;
  }>;
  resolutionCases?: Array<{ status: ResolutionStatus }>;
  cascadeReviews: Array<{ suggestedLevel: Level | null }>;
}) {
  const reviewTaskSummary = buildTaskSummary(application.reviewTasks);
  const reviewProgress = buildReviewProgress(application.reviewTasks.map((task) => task.status));
  const criterionStatuses = Object.fromEntries(
    application.reviewTasks
      .filter((task): task is { criterion: Criterion; status: ReviewTaskStatus; officerSuggestedLevel?: Level | null } =>
        Boolean(task.criterion),
      )
      .map((task) => [
        task.criterion,
        {
          status: task.status,
          officerSuggestedLevel: task.officerSuggestedLevel ?? null,
        },
      ]),
  );
  const openResolutionCases =
    application.resolutionCases?.filter(
      (item) => item.status === ResolutionStatus.open || item.status === ResolutionStatus.in_review,
    ).length ?? 0;
  const blockingReasons = buildBlockingReasons(reviewProgress, openResolutionCases);
  const suggestedLevel = application.cascadeReviews[0]?.suggestedLevel ?? null;
  const topBlockerReason = buildTopBlockerReason(application.reviewTasks, {
    targetLevel: application.targetLevel,
    suggestedLevel,
    openResolutionCases,
  });

  return {
    applicationId: application.id,
    studentId: application.studentId,
    studentName: application.student.fullName,
    studentCode: application.student.studentCode,
    className: application.student.className,
    faculty: application.student.faculty,
    schoolYear: application.schoolYear,
    targetLevel: application.targetLevel,
    suggestedLevel,
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
    reviewTaskSummary,
    criterionStatuses,
    taskProgress: {
      accepted: reviewTaskSummary.accepted,
      total: application.reviewTasks.length,
    },
    canFinalize: reviewProgress.canAggregate && openResolutionCases === 0,
    blockingReasons,
    topBlockerReason,
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
  avatarUrl?: string | null;
}) {
  return {
    id: student.id,
    fullName: student.fullName,
    studentCode: student.studentCode,
    className: student.className,
    faculty: student.faculty,
    avatarUrl: student.avatarUrl ?? null,
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

function buildTopBlockerReason(
  tasks: Array<{
    criterion?: Criterion;
    status: ReviewTaskStatus;
    officerSuggestedLevel?: Level | null;
    officerNote?: string | null;
    decisionReason?: string | null;
    evidences?: Array<{ evidenceId: string }>;
  }>,
  context: {
    targetLevel: Level;
    suggestedLevel: Level | null;
    openResolutionCases: number;
  },
) {
  const priority = [
    ReviewTaskStatus.rejected,
    ReviewTaskStatus.supplement_required,
    ReviewTaskStatus.resolution_needed,
    ReviewTaskStatus.reviewing,
    ReviewTaskStatus.waiting,
  ];
  const task = priority
    .flatMap((status) => tasks.filter((item) => item.status === status))
    .find(Boolean);

  if (task) {
    const prefix = task.criterion ? `${criterionDecisionLabel(task.criterion)}: ` : '';
    const note = task.decisionReason?.trim() || task.officerNote?.trim();
    if (note) return `${prefix}${note}`;
    if (task.status === ReviewTaskStatus.rejected) return `${prefix}Khong dat tieu chi.`;
    if (task.status === ReviewTaskStatus.supplement_required) {
      return `${prefix}Can bo sung minh chung hoac thong tin.`;
    }
    if (task.status === ReviewTaskStatus.resolution_needed) return `${prefix}Dang cho hoi dong hoi y.`;
    if (task.status === ReviewTaskStatus.reviewing) return `${prefix}Can bo dang xet task nay.`;
    return `${prefix}Task chua duoc xet.`;
  }

  if (context.openResolutionCases > 0) return 'Con resolution case chua xu ly.';
  if (!context.suggestedLevel) return 'Cascade moi nhat de xuat khong dat cap nao.';
  if (context.suggestedLevel !== context.targetLevel) {
    return `De xuat ha tu ${context.targetLevel} xuong ${context.suggestedLevel}.`;
  }
  return 'Khong co blocker chinh.';
}

function criterionDecisionLabel(criterion: Criterion) {
  const labels: Partial<Record<Criterion, string>> = {
    ethics: 'Dao duc',
    academic: 'Hoc tap',
    physical: 'The luc',
    volunteer: 'Tinh nguyen',
    integration: 'Hoi nhap',
    priority: 'Uu tien',
    collective: 'Tap the',
  };
  return labels[criterion] ?? criterion;
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
  level: Level | null,
  note: string,
): string {
  const levelLabel = getLevelLabel(level);
  if (status === FinalStatus.passed) {
    return `Hồ sơ Sinh viên 5 tốt của bạn đã có kết quả cuối cùng: đạt ${levelLabel}. Vui lòng xem chi tiết trong hệ thống.`;
  }
  if (status === FinalStatus.failed) {
    return `Hồ sơ Sinh viên 5 tốt của bạn đã có kết quả: chưa đạt. ${note}`;
  }
  return `Hồ sơ của bạn chưa đủ điều kiện cấp mục tiêu, nhưng được xác nhận ở ${levelLabel}.`;
}

function getLevelLabel(level: Level | null) {
  if (level === Level.school) return 'Cấp Trường';
  if (level === Level.university) return 'Cấp ĐHĐN';
  if (level === Level.city) return 'Cấp Thành phố';
  if (level === Level.central) return 'Cấp Trung ương';
  return 'không đạt cấp nào';
}

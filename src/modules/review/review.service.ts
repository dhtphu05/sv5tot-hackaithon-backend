// Owns officer review tasks, decisions, supplements, and escalation.
import {
  ApplicationStatus,
  NotificationType,
  ReviewDecision,
  ReviewTaskStatus,
  Role,
  type Criterion,
  type Prisma,
} from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { auditActions } from '../../shared/constants/application';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { createApplicationAudit } from '../applications/application.helpers';
import { NotificationsService } from '../notifications/notifications.service';
import { ReviewAssignmentService } from './review-assignment.service';
import { getApplicationReviewProgress } from './review-progress.service';
import { ReviewRepository } from './review.repository';
import type {
  EscalateResolutionInput,
  ListReviewTasksQuery,
  RequestSupplementInput,
  TaskDecisionInput,
} from './review.validation';

export class ReviewService {
  constructor(
    private readonly reviewRepository = new ReviewRepository(),
    private readonly assignmentService = new ReviewAssignmentService(),
    private readonly notificationsService = new NotificationsService(),
  ) {}

  async listTasks(user: AuthenticatedUser, query: ListReviewTasksQuery) {
    const data = await this.reviewRepository.list(user, query);
    const items = [];
    for (const task of data.items) {
      if (await this.canAccessTask(user, task, false)) {
        items.push(toTaskListItem(task));
      }
    }

    return {
      items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total: data.total,
        totalPages: Math.ceil(data.total / query.limit),
      },
    };
  }

  async getTaskDetail(user: AuthenticatedUser, taskId: string) {
    const task = await this.getTask(taskId);
    await this.assertTaskAccess(user, task, true);

    const taskForResponse =
      task.assignedOfficerId === user.id && task.status === ReviewTaskStatus.waiting
        ? await this.markTaskStarted(user, task)
        : task;

    const evidences = taskForResponse.evidences.map((item) => item.evidence);
    const knowledgeBaseMatches = await Promise.all(
      evidences.map(async (evidence) => ({
        evidenceId: evidence.id,
        matches: await prisma.knowledgeBaseItem.findMany({
          where: {
            criterion: evidence.criterion,
            OR: [
              { evidenceName: { contains: evidence.evidenceName, mode: 'insensitive' } },
              { eventName: { contains: evidence.evidenceName, mode: 'insensitive' } },
            ],
          },
          orderBy: [{ usageCount: 'desc' }, { updatedAt: 'desc' }],
          take: 3,
        }),
      })),
    );

    return {
      task: toTaskDetail(taskForResponse),
      application: taskForResponse.application
        ? toApplicationSummary(taskForResponse.application)
        : null,
      collectiveProfile: taskForResponse.collectiveProfile,
      student: taskForResponse.application?.student ?? null,
      metrics:
        taskForResponse.application?.metrics.filter(
          (metric) => metric.metricType === metricForCriterion(taskForResponse.criterion),
        ) ?? [],
      evidences: evidences.map((evidence) => ({
        id: evidence.id,
        evidenceName: evidence.evidenceName,
        criterion: evidence.criterion,
        sourceType: evidence.sourceType,
        status: evidence.status,
        indexingStatus: evidence.indexingStatus,
        confidence: evidence.confidence,
        files: evidence.evidenceFiles.map((item) => item.file),
        card: evidence.evidenceCard,
        event: evidence.event,
      })),
      precheck:
        taskForResponse.application?.precheckResults[0] ??
        taskForResponse.collectiveProfile?.precheckResults[0] ??
        null,
      cascade: taskForResponse.application?.cascadeReviews[0] ?? null,
      knowledgeBaseMatches,
      criteriaChecklist: buildCriteriaChecklist(taskForResponse.criterion),
    };
  }

  async decideTask(user: AuthenticatedUser, taskId: string, input: TaskDecisionInput) {
    const task = await this.getTask(taskId);
    await this.assertTaskAccess(user, task, true);

    if (task.status === ReviewTaskStatus.accepted || task.status === ReviewTaskStatus.rejected) {
      if (user.role !== Role.manager && user.role !== Role.admin) {
        throw new AppError(
          409,
          ErrorCodes.REVIEW_TASK_ALREADY_DECIDED,
          'Review task has already been decided',
        );
      }
    }

    if (
      (input.decision === ReviewDecision.rejected ||
        input.decision === ReviewDecision.supplement_required ||
        input.decision === ReviewDecision.resolution_needed) &&
      !input.officerNote
    ) {
      throw new AppError(
        400,
        ErrorCodes.DECISION_NOTE_REQUIRED,
        'Officer note is required for this decision',
      );
    }

    if (task.collectiveProfileId && task.collectiveProfile) {
      return this.decideCollectiveTask(user, task, input);
    }
    if (!task.applicationId || !task.application) {
      throw new AppError(409, ErrorCodes.REVIEW_TASK_NOT_FOUND, 'Review task owner is missing');
    }
    const applicationId = task.applicationId;
    const application = task.application;

    const updated = await prisma.$transaction(async (tx) => {
      const status = mapDecisionToStatus(input.decision);
      const saved = await tx.reviewTask.update({
        where: { id: task.id },
        data: {
          status,
          decision: input.decision,
          officerNote: input.officerNote,
        },
        include: { application: { include: { student: true } }, assignedOfficer: true },
      });

      for (const evidenceDecision of input.evidenceDecisions) {
        await tx.evidence.update({
          where: { id: evidenceDecision.evidenceId },
          data: { status: evidenceDecision.status },
        });
      }

      if (input.decision === ReviewDecision.supplement_required) {
        await tx.application.update({
          where: { id: applicationId },
          data: { status: ApplicationStatus.supplement_required },
        });
        await this.notificationsService.create(
          {
            userId: application.studentId,
            applicationId,
            type: NotificationType.supplement_required,
            title: 'Cần bổ sung minh chứng',
            message: input.officerNote ?? 'Hồ sơ cần bổ sung minh chứng.',
          },
          tx,
        );
      }

      if (input.decision === ReviewDecision.resolution_needed) {
        await tx.application.update({
          where: { id: applicationId },
          data: { status: ApplicationStatus.resolution_needed },
        });
        await tx.resolutionCase.create({
          data: {
            applicationId,
            reason: input.officerNote ?? 'Cần hội đồng xem xét.',
            createdBy: user.id,
          },
        });
        await notifyManagers(
          tx,
          applicationId,
          'Có hồ sơ cần xử lý đối sánh',
          input.officerNote ?? 'Một task được chuyển sang cần hội đồng xem xét.',
        );
      }

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.REVIEW_TASK_DECIDED,
        targetType: 'review_task',
        targetId: task.id,
        applicationId,
        beforeStateJson: { status: task.status, decision: task.decision },
        afterStateJson: { status, decision: input.decision },
        note: input.officerNote,
      });
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: decisionAuditAction(input.decision),
        targetType: 'review_task',
        targetId: task.id,
        applicationId,
        afterStateJson: { status, decision: input.decision },
        note: input.officerNote,
      });

      return saved;
    });

    return {
      task: updated,
      application: {
        id: applicationId,
        status:
          input.decision === ReviewDecision.supplement_required
            ? ApplicationStatus.supplement_required
            : input.decision === ReviewDecision.resolution_needed
              ? ApplicationStatus.resolution_needed
              : application.status,
      },
      collectiveProfile: null,
      reviewProgress: await getApplicationReviewProgress(applicationId),
    };
  }

  requestSupplement(user: AuthenticatedUser, taskId: string, input: RequestSupplementInput) {
    return this.decideTask(user, taskId, {
      decision: ReviewDecision.supplement_required,
      officerNote: input.reason,
      evidenceDecisions: [],
    }).then(async (result) => {
      if (input.deadline) {
        await prisma.reviewTask.update({
          where: { id: taskId },
          data: { dueDate: new Date(input.deadline) },
        });
      }
      await createApplicationAudit(prisma, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.SUPPLEMENT_REQUESTED,
        targetType: 'review_task',
        targetId: taskId,
        applicationId: result.application?.id,
        collectiveProfileId: result.collectiveProfile?.id,
        afterStateJson: {
          requestedEvidenceName: input.requestedEvidenceName,
          allowedCriteria: input.allowedCriteria,
          deadline: input.deadline,
        },
        note: input.reason,
      });
      return result;
    });
  }

  async escalateResolution(
    user: AuthenticatedUser,
    taskId: string,
    input: EscalateResolutionInput,
  ) {
    const task = await this.getTask(taskId);
    await this.assertTaskAccess(user, task, true);
    if (task.collectiveProfileId && task.collectiveProfile) {
      return this.decideCollectiveTask(user, task, {
        decision: ReviewDecision.resolution_needed,
        officerNote: input.reason,
        evidenceDecisions: [],
      });
    }
    if (!task.applicationId || !task.application) {
      throw new AppError(409, ErrorCodes.REVIEW_TASK_NOT_FOUND, 'Review task owner is missing');
    }
    const applicationId = task.applicationId;

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.reviewTask.update({
        where: { id: task.id },
        data: {
          status: ReviewTaskStatus.resolution_needed,
          decision: ReviewDecision.resolution_needed,
          officerNote: input.reason,
        },
      });
      const resolutionCase = await tx.resolutionCase.create({
        data: {
          applicationId,
          evidenceId: input.evidenceId,
          reason: input.reason,
          createdBy: user.id,
        },
      });
      await tx.application.update({
        where: { id: applicationId },
        data: { status: ApplicationStatus.resolution_needed },
      });
      await notifyManagers(tx, applicationId, 'Có hồ sơ cần hội đồng xem xét', input.reason);
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.RESOLUTION_CASE_CREATED,
        targetType: 'resolution_case',
        targetId: resolutionCase.id,
        applicationId,
        afterStateJson: { evidenceId: input.evidenceId, status: resolutionCase.status },
        note: input.reason,
      });
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.REVIEW_TASK_ESCALATED_RESOLUTION,
        targetType: 'review_task',
        targetId: task.id,
        applicationId,
        beforeStateJson: { status: task.status },
        afterStateJson: { status: ReviewTaskStatus.resolution_needed },
        note: input.reason,
      });
      return saved;
    });

    return {
      task: updated,
      application: { id: applicationId, status: ApplicationStatus.resolution_needed },
      collectiveProfile: null,
      reviewProgress: await getApplicationReviewProgress(applicationId),
    };
  }

  private async getTask(taskId: string) {
    const task = await this.reviewRepository.findDetail(taskId);
    if (!task) {
      throw new AppError(404, ErrorCodes.REVIEW_TASK_NOT_FOUND, 'Review task not found');
    }
    return task;
  }

  private async assertTaskAccess(
    user: AuthenticatedUser,
    task: Awaited<ReturnType<ReviewRepository['findDetail']>> & {},
    decision: boolean,
  ) {
    if (!(await this.canAccessTask(user, task, decision))) {
      throw new AppError(
        403,
        ErrorCodes.REVIEW_TASK_PERMISSION_DENIED,
        'You do not have access to this review task',
      );
    }
  }

  private async canAccessTask(
    user: AuthenticatedUser,
    task: {
      assignedOfficerId: string | null;
      status: ReviewTaskStatus;
      criterion: Criterion;
      application: { student: { faculty: string | null } } | null;
      collectiveProfile: { representative: { faculty: string | null } } | null;
    },
    decision: boolean,
  ): Promise<boolean> {
    if (user.role === Role.manager || user.role === Role.admin) {
      return true;
    }
    if (user.role === Role.committee) {
      return !decision && task.status === ReviewTaskStatus.resolution_needed;
    }
    if (user.role !== Role.officer) {
      return false;
    }
    if (task.assignedOfficerId === user.id) {
      return true;
    }
    if (decision) {
      return false;
    }
    return (
      !task.assignedOfficerId &&
      (await this.assignmentService.canOfficerHandleCriterion(
        user.id,
        task.criterion,
        task.application?.student.faculty ?? task.collectiveProfile?.representative.faculty,
      ))
    );
  }

  private async markTaskStarted(
    user: AuthenticatedUser,
    task: NonNullable<Awaited<ReturnType<ReviewRepository['findDetail']>>>,
  ) {
    await prisma.reviewTask.update({
      where: { id: task.id },
      data: { status: ReviewTaskStatus.reviewing },
    });
    await createApplicationAudit(prisma, {
      actorId: user.id,
      actorRole: user.role,
      action: auditActions.REVIEW_TASK_STARTED,
      targetType: 'review_task',
      targetId: task.id,
      applicationId: task.applicationId,
      collectiveProfileId: task.collectiveProfileId,
      beforeStateJson: { status: task.status },
      afterStateJson: { status: ReviewTaskStatus.reviewing },
    });

    const refreshed = await this.reviewRepository.findDetail(task.id);
    return refreshed ?? task;
  }

  private async decideCollectiveTask(
    user: AuthenticatedUser,
    task: NonNullable<Awaited<ReturnType<ReviewRepository['findDetail']>>>,
    input: TaskDecisionInput,
  ) {
    const collectiveProfile = task.collectiveProfile;
    if (!task.collectiveProfileId || !collectiveProfile) {
      throw new AppError(
        404,
        ErrorCodes.COLLECTIVE_REVIEW_TASK_NOT_FOUND,
        'Collective task not found',
      );
    }
    const profileId = task.collectiveProfileId;
    const status = mapDecisionToStatus(input.decision);
    const profileStatus =
      input.decision === ReviewDecision.supplement_required
        ? 'supplement_required'
        : input.decision === ReviewDecision.resolution_needed
          ? 'resolution_needed'
          : 'under_review';

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.reviewTask.update({
        where: { id: task.id },
        data: { status, decision: input.decision, officerNote: input.officerNote },
        include: { collectiveProfile: true, assignedOfficer: true },
      });
      for (const evidenceDecision of input.evidenceDecisions) {
        await tx.evidence.update({
          where: { id: evidenceDecision.evidenceId },
          data: { status: evidenceDecision.status },
        });
      }
      await tx.collectiveProfile.update({
        where: { id: profileId },
        data: { status: profileStatus },
      });
      if (input.decision === ReviewDecision.supplement_required) {
        await this.notificationsService.create(
          {
            userId: collectiveProfile.representativeId,
            collectiveProfileId: profileId,
            type: NotificationType.supplement_required,
            title: 'Cần bổ sung hồ sơ tập thể',
            message: input.officerNote ?? 'Hồ sơ tập thể cần bổ sung.',
          },
          tx,
        );
      }
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.REVIEW_TASK_DECIDED,
        targetType: 'review_task',
        targetId: task.id,
        collectiveProfileId: profileId,
        beforeStateJson: { status: task.status, decision: task.decision },
        afterStateJson: { status, decision: input.decision },
        note: input.officerNote,
      });
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: decisionAuditAction(input.decision),
        targetType: 'review_task',
        targetId: task.id,
        collectiveProfileId: profileId,
        afterStateJson: { status, decision: input.decision },
        note: input.officerNote,
      });
      return saved;
    });

    return {
      task: updated,
      application: null,
      collectiveProfile: { id: profileId, status: profileStatus },
      reviewProgress: null,
    };
  }
}

function mapDecisionToStatus(decision: ReviewDecision): ReviewTaskStatus {
  if (decision === ReviewDecision.accepted) return ReviewTaskStatus.accepted;
  if (decision === ReviewDecision.rejected) return ReviewTaskStatus.rejected;
  if (decision === ReviewDecision.supplement_required) return ReviewTaskStatus.supplement_required;
  return ReviewTaskStatus.resolution_needed;
}

function decisionAuditAction(decision: ReviewDecision): string {
  if (decision === ReviewDecision.accepted) return auditActions.REVIEW_TASK_ACCEPTED;
  if (decision === ReviewDecision.rejected) return auditActions.REVIEW_TASK_REJECTED;
  if (decision === ReviewDecision.supplement_required) {
    return auditActions.REVIEW_TASK_SUPPLEMENT_REQUIRED;
  }
  return auditActions.REVIEW_TASK_ESCALATED_RESOLUTION;
}

async function notifyManagers(
  tx: Prisma.TransactionClient,
  applicationId: string,
  title: string,
  message: string,
) {
  const managers = await tx.user.findMany({
    where: { role: { in: [Role.manager, Role.committee, Role.admin] }, isActive: true },
    select: { id: true },
  });

  await Promise.all(
    managers.map((manager) =>
      tx.notification.create({
        data: {
          userId: manager.id,
          applicationId,
          type: NotificationType.review_updated,
          title,
          message,
        },
      }),
    ),
  );
}

function toTaskListItem(task: {
  id: string;
  criterion: Criterion;
  status: ReviewTaskStatus;
  decision: ReviewDecision | null;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  application: {
    id: string;
    schoolYear: string;
    targetLevel: string;
    status: string;
    student: {
      fullName: string;
      studentCode: string | null;
      className: string | null;
      faculty: string | null;
    };
  } | null;
  collectiveProfile: {
    id: string;
    schoolYear: string;
    targetLevel: string;
    status: string;
    className: string;
    representative: {
      fullName: string;
      faculty: string | null;
    };
  } | null;
  assignedOfficer: { id: string; fullName: string } | null;
  _count: { evidences: number };
}) {
  return {
    id: task.id,
    criterion: task.criterion,
    status: task.status,
    decision: task.decision,
    dueDate: task.dueDate,
    application: task.application,
    collectiveProfile: task.collectiveProfile,
    evidenceCount: task._count.evidences,
    assignedOfficer: task.assignedOfficer
      ? { id: task.assignedOfficer.id, fullName: task.assignedOfficer.fullName }
      : null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function toTaskDetail(task: NonNullable<Awaited<ReturnType<ReviewRepository['findDetail']>>>) {
  return {
    id: task.id,
    criterion: task.criterion,
    status: task.status,
    decision: task.decision,
    officerNote: task.officerNote,
    assignedOfficer: task.assignedOfficer,
    dueDate: task.dueDate,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function toApplicationSummary(taskApplication: {
  id: string;
  schoolYear: string;
  targetLevel: string;
  status: string;
  readinessScore: number;
  submittedAt: Date | null;
}) {
  return {
    id: taskApplication.id,
    schoolYear: taskApplication.schoolYear,
    targetLevel: taskApplication.targetLevel,
    status: taskApplication.status,
    readinessScore: taskApplication.readinessScore,
    submittedAt: taskApplication.submittedAt,
  };
}

function metricForCriterion(criterion: Criterion) {
  if (criterion === 'academic') return 'gpa';
  if (criterion === 'ethics') return 'conduct_score';
  if (criterion === 'physical') return 'physical_score';
  if (criterion === 'volunteer') return 'volunteer_days';
  if (criterion === 'integration') return 'foreign_language_score';
  return undefined;
}

function buildCriteriaChecklist(criterion: Criterion) {
  return [
    {
      criterion,
      humanConfirmationRequired: true,
      note: 'Officer decision là xác nhận theo tiêu chí/task, chưa phải kết quả cuối cùng toàn hồ sơ.',
    },
  ];
}

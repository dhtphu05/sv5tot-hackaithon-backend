// Owns officer review tasks, decisions, supplements, and escalation.
import {
  ApplicationStatus,
  Criterion,
  NotificationType,
  ReviewDecision,
  ReviewTaskStatus,
  Role,
  type Prisma,
} from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { auditActions } from '../../shared/constants/application';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { createApplicationAudit } from '../applications/application.helpers';
import {
  createNotification,
  NotificationsService,
} from '../notifications/notifications.service';
import { ReviewAssignmentService } from './review-assignment.service';
import { getApplicationReviewProgress } from './review-progress.service';
import { ReviewRepository } from './review.repository';
import type { ListReviewTasksQuery, TaskDecisionInput } from './review.validation';

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

    const auditLogs = taskForResponse.applicationId
      ? await prisma.auditLog.findMany({
          where: { applicationId: taskForResponse.applicationId },
          orderBy: { createdAt: 'desc' },
        })
      : [];

    return {
      task: toTaskDetail(taskForResponse),
      application: taskForResponse.application
        ? {
            id: taskForResponse.application.id,
            schoolYear: taskForResponse.application.schoolYear,
            targetLevel: taskForResponse.application.targetLevel,
            applicationType: taskForResponse.application.applicationType,
            status: taskForResponse.application.status,
          }
        : null,
      collectiveProfile: taskForResponse.collectiveProfile,
      student: taskForResponse.application?.student
        ? {
            id: taskForResponse.application.student.id,
            fullName: taskForResponse.application.student.fullName,
            studentCode: taskForResponse.application.student.studentCode,
            className: taskForResponse.application.student.className,
            faculty: taskForResponse.application.student.faculty,
            email: taskForResponse.application.student.email,
          }
        : null,
      metrics:
        taskForResponse.application?.metrics.filter(
          (metric) => metric.metricType === metricForCriterion(taskForResponse.criterion),
        ) ?? [],
      evidences: evidences.map((evidence) => ({
        id: evidence.id,
        applicationId: evidence.applicationId,
        evidenceName: evidence.evidenceName,
        criterion: evidence.criterion,
        sourceType: evidence.sourceType,
        status: evidence.status,
        indexingStatus: evidence.indexingStatus,
        confidence: evidence.confidence,
        createdAt: evidence.createdAt,
        updatedAt: evidence.updatedAt,
        files: (evidence.evidenceFiles || []).map((link) => ({
          id: link.file.id,
          originalName: link.file.originalName,
          mimeType: link.file.mimeType,
          fileSize: link.file.fileSize,
          publicUrl: link.file.publicUrl,
          fileRole: link.fileRole,
        })),
        card: evidence.evidenceCard
          ? {
              id: evidence.evidenceCard.id,
              confidence: evidence.evidenceCard.confidence,
              warnings: evidence.evidenceCard.warningsJson || [],
            }
          : null,
      })),
      precheck:
        taskForResponse.application?.precheckResults[0] ??
        taskForResponse.collectiveProfile?.precheckResults[0] ??
        null,
      cascade: taskForResponse.application?.cascadeReviews[0] ?? null,
      knowledgeBaseMatches,
      criteriaChecklist: buildCriteriaChecklist(taskForResponse.criterion),
      audit: auditLogs,
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

    // Verify evidenceDecisions belong to task
    const linkedEvidenceIds = new Set(task.evidences.map((te) => te.evidenceId));
    for (const ed of input.evidenceDecisions) {
      if (!linkedEvidenceIds.has(ed.evidenceId)) {
        throw new AppError(
          400,
          ErrorCodes.VALIDATION_ERROR,
          `Evidence ${ed.evidenceId} does not belong to this review task`,
        );
      }
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

      // Update specific or all linked evidences based on decision status
      const evidenceIds = task.evidences.map((e) => e.evidenceId);
      if (input.evidenceDecisions.length > 0) {
        for (const ed of input.evidenceDecisions) {
          await tx.evidence.update({
            where: { id: ed.evidenceId },
            data: { status: ed.status },
          });
        }
      } else {
        let defaultEvidenceStatus = 'under_review';
        if (input.decision === ReviewDecision.accepted) defaultEvidenceStatus = 'accepted';
        if (input.decision === ReviewDecision.rejected) defaultEvidenceStatus = 'rejected';
        if (input.decision === ReviewDecision.supplement_required) defaultEvidenceStatus = 'needs_supplement';
        if (input.decision === ReviewDecision.resolution_needed) defaultEvidenceStatus = 'resolution_needed';

        await tx.evidence.updateMany({
          where: { id: { in: evidenceIds } },
          data: { status: defaultEvidenceStatus as any },
        });
      }

      // Audit status updates
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: 'EVIDENCE_STATUS_UPDATED',
        targetType: 'review_task',
        targetId: task.id,
        applicationId,
        afterStateJson: { decision: input.decision },
      });

      if (input.decision === ReviewDecision.supplement_required) {
        await tx.application.update({
          where: { id: applicationId },
          data: { status: ApplicationStatus.supplement_required },
        });
        await this.notificationsService.create(
          {
            userId: application.studentId,
            applicationId,
            reviewTaskId: task.id,
            metadata: { criterion: task.criterion, evidenceIds },
            type: NotificationType.supplement_requested,
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

        const existingCase = await tx.resolutionCase.findFirst({
          where: { applicationId, status: 'open' },
        });
        let resolutionCaseId = existingCase?.id ?? null;
        if (!existingCase) {
          const createdCase = await tx.resolutionCase.create({
            data: {
              applicationId,
              reason: input.officerNote ?? 'Cần hội đồng xem xét.',
              createdBy: user.id,
              status: 'open',
            },
          });
          resolutionCaseId = createdCase.id;
        }

        await this.notificationsService.create(
          {
            userId: application.studentId,
            applicationId,
            reviewTaskId: task.id,
            resolutionCaseId,
            metadata: { criterion: task.criterion, evidenceIds },
            type: NotificationType.resolution_updated,
            title: 'Hồ sơ được chuyển hội đồng xem xét',
            message: input.officerNote ?? 'Một tiêu chí cần hội đồng xem xét.',
          },
          tx,
        );
        await notifyManagers(
          tx,
          applicationId,
          resolutionCaseId,
          'Có hồ sơ cần xử lý đối sánh',
          input.officerNote ?? 'Một task được chuyển sang cần hội đồng xem xét.',
          { reviewTaskId: task.id, criterion: task.criterion, evidenceIds },
        );
      }

      // Check if all required tasks are accepted -> complete application
      if (input.decision === ReviewDecision.accepted) {
        const allTasks = await tx.reviewTask.findMany({
          where: { applicationId },
        });
        const allAccepted = allTasks.every((t) =>
          t.id === task.id ? status === ReviewTaskStatus.accepted : t.status === ReviewTaskStatus.accepted,
        );
        if (allAccepted && allTasks.length > 0) {
          await tx.application.update({
            where: { id: applicationId },
            data: { status: ApplicationStatus.completed },
          });
        }
      }

      // Audit application status changes
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: 'APPLICATION_STATUS_UPDATED',
        targetType: 'application',
        targetId: applicationId,
        applicationId,
        afterStateJson: { status: application.status },
      });

      let auditActionName = 'REVIEW_DECISION_ACCEPTED';
      if (input.decision === ReviewDecision.rejected) auditActionName = 'REVIEW_DECISION_REJECTED';
      if (input.decision === ReviewDecision.supplement_required) auditActionName = 'REVIEW_SUPPLEMENT_REQUESTED';
      if (input.decision === ReviewDecision.resolution_needed) auditActionName = 'REVIEW_ESCALATED_TO_RESOLUTION';

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActionName,
        targetType: 'review_task',
        targetId: task.id,
        applicationId,
        afterStateJson: { status, decision: input.decision },
        note: input.officerNote,
      });

      if (
        input.decision !== ReviewDecision.supplement_required &&
        input.decision !== ReviewDecision.resolution_needed
      ) {
        await this.notificationsService.create(
          {
            userId: application.studentId,
            applicationId,
            reviewTaskId: task.id,
            metadata: { criterion: task.criterion, decision: input.decision },
            type: NotificationType.review_updated,
            title: 'Đánh giá hồ sơ đã cập nhật',
            message: `Tiêu chí ${task.criterion} đã được đánh giá: ${input.decision}.`,
          },
          tx,
        );
      }

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

  async requestSupplement(
    user: AuthenticatedUser,
    taskId: string,
    input: {
      reason: string;
      deadline?: string;
      evidenceIds?: string[];
      requestedFields?: string[];
    },
  ) {
    const evidenceDecisions = (input.evidenceIds || []).map((id) => ({
      evidenceId: id,
      status: 'needs_supplement' as any,
    }));

    const result = await this.decideTask(user, taskId, {
      decision: ReviewDecision.supplement_required,
      officerNote: input.reason,
      evidenceDecisions,
    });

    if (input.deadline) {
      await prisma.reviewTask.update({
        where: { id: taskId },
        data: { dueDate: new Date(input.deadline) },
      });
    }

    await createApplicationAudit(prisma, {
      actorId: user.id,
      actorRole: user.role,
      action: 'REVIEW_SUPPLEMENT_REQUESTED',
      targetType: 'review_task',
      targetId: taskId,
      applicationId: result.application?.id,
      afterStateJson: {
        requestedFields: input.requestedFields,
        evidenceIds: input.evidenceIds,
        deadline: input.deadline,
      },
      note: input.reason,
    });

    return result;
  }

  async escalateResolution(
    user: AuthenticatedUser,
    taskId: string,
    input: {
      reason: string;
      evidenceIds?: string[];
      priority?: string;
    },
  ) {
    const evidenceDecisions = (input.evidenceIds || []).map((id) => ({
      evidenceId: id,
      status: 'resolution_needed' as any,
    }));

    const result = await this.decideTask(user, taskId, {
      decision: ReviewDecision.resolution_needed,
      officerNote: input.reason,
      evidenceDecisions,
    });

    await createApplicationAudit(prisma, {
      actorId: user.id,
      actorRole: user.role,
      action: 'REVIEW_ESCALATED_TO_RESOLUTION',
      targetType: 'review_task',
      targetId: taskId,
      applicationId: result.application?.id,
      afterStateJson: {
        evidenceIds: input.evidenceIds,
        priority: input.priority || 'normal',
      },
      note: input.reason,
    });

    return result;
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
    task: NonNullable<Awaited<ReturnType<ReviewRepository['findDetail']>>>,
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
            reviewTaskId: task.id,
            metadata: { criterion: task.criterion },
            type: NotificationType.supplement_requested,
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

  async ensureReviewTasks(
    user: AuthenticatedUser,
    applicationId: string,
    input: { mode?: 'missing_only' | 'all' },
  ) {
    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      include: { student: true },
    });

    if (!application) {
      throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
    }

    const allowedStatuses = ['submitted', 'under_review', 'supplement_required', 'resolution_needed'];
    if (application.status === 'draft') {
      throw new AppError(400, ErrorCodes.INVALID_APPLICATION_STATUS, 'Cannot ensure tasks for draft application');
    }
    if (!allowedStatuses.includes(application.status)) {
      throw new AppError(
        400,
        ErrorCodes.INVALID_APPLICATION_STATUS,
        'Application must be submitted or under review to ensure tasks',
      );
    }

    // Find all evidences for this application
    const evidences = await prisma.evidence.findMany({
      where: { applicationId },
    });

    // 5 main criteria + any criteria with evidences
    const criteriaToEnsure = new Set<Criterion>([
      Criterion.ethics,
      Criterion.academic,
      Criterion.physical,
      Criterion.volunteer,
      Criterion.integration,
    ]);
    for (const ev of evidences) {
      criteriaToEnsure.add(ev.criterion);
    }

    // Existing tasks to prevent duplicate (idempotency check)
    const existingTasks = await prisma.reviewTask.findMany({
      where: { applicationId },
    });
    const existingCriteria = new Set(existingTasks.map((t) => t.criterion));

    const criteriaToCreate = Array.from(criteriaToEnsure).filter(
      (c) => !existingCriteria.has(c),
    );

    const createdTasks: any[] = [];

    await prisma.$transaction(async (tx) => {
      for (const criterion of criteriaToCreate) {
        // Find assigned officer with matching criterion and minimum workload
        const assignedOfficerId = await this.findAssignedOfficer(
          criterion,
          application.student?.faculty,
        );

        // Create the task
        const task = await tx.reviewTask.create({
          data: {
            applicationId,
            criterion,
            assignedOfficerId,
            status: 'waiting',
          },
        });

        // Link existing evidences to this task
        const matchingEvidences = evidences.filter((e) => e.criterion === criterion);
        for (const ev of matchingEvidences) {
          await tx.reviewTaskEvidence.create({
            data: {
              reviewTaskId: task.id,
              evidenceId: ev.id,
            },
          });
        }

        createdTasks.push(task);

        // Audit for each created task
        await createApplicationAudit(tx, {
          actorId: user.id,
          actorRole: user.role,
          action: 'REVIEW_TASK_CREATED',
          targetType: 'review_task',
          targetId: task.id,
          applicationId,
          afterStateJson: { criterion, status: 'waiting' },
        });

        if (assignedOfficerId) {
          await createApplicationAudit(tx, {
            actorId: user.id,
            actorRole: user.role,
            action: 'REVIEW_TASK_ASSIGNED',
            targetType: 'review_task',
            targetId: task.id,
            applicationId,
            afterStateJson: { assignedOfficerId },
          });
        }
      }

      // Update application status if submitted
      if (application.status === 'submitted') {
        await tx.application.update({
          where: { id: applicationId },
          data: { status: 'under_review' },
        });
      }

      // Audit for ensure execution
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: 'REVIEW_TASKS_ENSURED',
        targetType: 'application',
        targetId: applicationId,
        applicationId,
        afterStateJson: { count: createdTasks.length, mode: input.mode || 'missing_only' },
      });
    });

    return {
      ensuredCount: criteriaToCreate.length,
      createdTaskIds: createdTasks.map((t) => t.id),
    };
  }

  private async findAssignedOfficer(
    criterion: Criterion,
    faculty?: string | null,
  ): Promise<string | null> {
    const specs = await prisma.officerSpecialization.findMany({
      where: {
        criterion,
        isActive: true,
        officer: { isActive: true },
      },
      include: {
        officer: {
          include: {
            assignedReviewTasks: {
              where: {
                status: {
                  in: ['waiting', 'reviewing', 'supplement_required'],
                },
              },
            },
          },
        },
      },
    });

    if (specs.length === 0) return null;

    // Filter by faculty scope preference if faculty is provided
    let candidateSpecs = specs;
    if (faculty) {
      const matchingFaculty = specs.filter((s) => s.facultyScope === faculty);
      if (matchingFaculty.length > 0) {
        candidateSpecs = matchingFaculty;
      } else {
        // Fallback to global scopes (where facultyScope is null or empty)
        candidateSpecs = specs.filter((s) => !s.facultyScope);
      }
    }

    if (candidateSpecs.length === 0) {
      candidateSpecs = specs;
    }

    // Sort by active task count
    candidateSpecs.sort((a, b) => {
      const countA = a.officer.assignedReviewTasks.length;
      const countB = b.officer.assignedReviewTasks.length;
      return countA - countB;
    });

    return candidateSpecs[0].officerId;
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
  resolutionCaseId: string | null,
  title: string,
  message: string,
  metadata?: unknown,
) {
  const managers = await tx.user.findMany({
    where: { role: { in: [Role.manager, Role.committee, Role.admin] }, isActive: true },
    select: { id: true },
  });

  await Promise.all(
    managers.map((manager) =>
      createNotification(
        {
          userId: manager.id,
          applicationId,
          resolutionCaseId,
          type: NotificationType.resolution_updated,
          title,
          message,
          metadata,
        },
        tx,
      ),
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

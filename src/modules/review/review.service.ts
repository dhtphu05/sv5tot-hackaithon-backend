// Owns officer review tasks, decisions, supplements, and escalation.
import {
  ApprovedEvidenceApprovalSource,
  ApplicationStatus,
  Criterion,
  EvidenceStatus,
  FinalStatus,
  Level,
  NotificationType,
  ReviewDecision,
  ReviewTaskStatus,
  Role,
  type Prisma,
} from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { auditActions } from '../../shared/constants/application';
import { buildReadableSummary } from '../../shared/dto/evidence-student-status';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { assertSameWorkspace, workspaceFilterFor } from '../../shared/utils/workspace-scope';
import { createApplicationAudit } from '../applications/application.helpers';
import { buildEvidenceCardFieldLayers } from '../evidences/evidence-card-field-presenter';
import { EvidenceKnowledgePublisher } from '../evidence-knowledge/evidence-knowledge.publisher';
import { EvidenceKnowledgeService } from '../evidence-knowledge/evidence-knowledge.service';
import { buildEmailDedupeKey, EmailOutboxService } from '../mail/email-outbox.service';
import { createNotification, NotificationsService } from '../notifications/notifications.service';
import { ReviewAssignmentService } from './review-assignment.service';
import { getApplicationReviewProgress } from './review-progress.service';
import { ReviewRepository, reviewTaskListInclude } from './review.repository';
import type {
  ListReviewTasksQuery,
  ReviewTaskPrecedentCheckQuery,
  TaskDecisionInput,
} from './review.validation';

type RequirementStatus = 'passed' | 'failed' | 'missing' | 'needs_review';
type RiskLevel = 'low' | 'medium' | 'high';
type ReviewTaskPermissionReason =
  | 'manager_full_access'
  | 'committee_resolution_view'
  | 'assigned_to_you'
  | 'claimable_by_specialization'
  | 'assigned_to_other'
  | 'finalized'
  | 'out_of_scope'
  | 'role_not_allowed';

type ReviewTaskAvailableAction =
  'view' | 'decide' | 'request_supplement' | 'escalate_resolution' | 'claim' | 'request_support';

type ReviewTaskPermissions = {
  canView: boolean;
  canAct: boolean;
  canClaim: boolean;
  canRequestSupport: boolean;
  reason: ReviewTaskPermissionReason;
  reasonLabel: string;
  badges: string[];
  availableActions: ReviewTaskAvailableAction[];
};

type ReviewTaskPriorityReason =
  | 'overdue'
  | 'student_resubmitted'
  | 'low_ai_confidence'
  | 'due_soon'
  | 'assigned_to_you'
  | 'unassigned_claimable'
  | null;

type OfficerCriterionAccessCache = Map<string, Promise<boolean>>;

export class ReviewService {
  constructor(
    private readonly reviewRepository = new ReviewRepository(),
    private readonly assignmentService = new ReviewAssignmentService(),
    private readonly notificationsService = new NotificationsService(),
    private readonly emailOutboxService = new EmailOutboxService(),
    private readonly evidenceKnowledgeService = new EvidenceKnowledgeService(),
    private readonly evidenceKnowledgePublisher = new EvidenceKnowledgePublisher(),
  ) {}

  async getDashboard(user: AuthenticatedUser) {
    const officer =
      user.role === Role.officer
        ? await prisma.user.findUnique({
            where: { id: user.id },
            include: {
              officerSpecializations: {
                where: { isActive: true },
                select: { criterion: true, facultyScope: true },
              },
            },
          })
        : null;

    const data = await this.reviewRepository.list(user, {
      page: 1,
      limit: 100,
    });
    const permissionCache: OfficerCriterionAccessCache = new Map();
    const accessible = [];
    for (const task of data.items) {
      if (await this.canAccessTask(user, task, false, permissionCache)) {
        accessible.push(task);
      }
    }

    const now = Date.now();
    const threeDays = 3 * 24 * 60 * 60 * 1000;
    const listItems = (
      await Promise.all(
        accessible.map(async (task) => {
          const item = toTaskListItem(task);
          const permissions = await this.getTaskPermissions(user, task, permissionCache);
          return {
            ...item,
            permissions,
            priorityReason: getTaskPriorityReason(item, permissions),
          };
        }),
      )
    ).sort(comparePriorityTasks);
    const summary = {
      totalAssigned: listItems.length,
      waiting: listItems.filter((item) => item.status === ReviewTaskStatus.waiting).length,
      reviewing: listItems.filter((item) => item.status === ReviewTaskStatus.reviewing).length,
      supplementRequired: listItems.filter(
        (item) => item.status === ReviewTaskStatus.supplement_required,
      ).length,
      accepted: listItems.filter((item) => item.status === ReviewTaskStatus.accepted).length,
      rejected: listItems.filter((item) => item.status === ReviewTaskStatus.rejected).length,
      resolutionNeeded: listItems.filter(
        (item) => item.status === ReviewTaskStatus.resolution_needed,
      ).length,
      aiLowConfidence: listItems.filter((item) => (item.aiConfidence ?? 1) < 0.7).length,
      overdue: listItems.filter((item) => item.dueDate && new Date(item.dueDate).getTime() < now)
        .length,
      dueSoon: listItems.filter((item) => {
        if (!item.dueDate) return false;
        const due = new Date(item.dueDate).getTime();
        return due >= now && due <= now + threeDays;
      }).length,
    };

    const bottleneckByCriterion = Object.values(Criterion).map((criterion) => ({
      criterion,
      total: listItems.filter((item) => item.criterion === criterion).length,
      waiting: listItems.filter(
        (item) => item.criterion === criterion && item.status === ReviewTaskStatus.waiting,
      ).length,
    }));

    const recentActivity = await prisma.auditLog.findMany({
      where: {
        targetType: 'review_task',
        targetId: { in: accessible.map((task) => task.id) },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return {
      officer: officer
        ? {
            id: officer.id,
            fullName: officer.fullName,
            specializations: officer.officerSpecializations.map((item) => item.criterion),
            specializationScopes: officer.officerSpecializations,
          }
        : {
            id: user.id,
            fullName: user.fullName,
            specializations: [],
            specializationScopes: [],
          },
      summary,
      priorityTasks: listItems
        .filter(isActionablePriorityTask)
        .slice(0, 8)
        .map((item) => ({
          taskId: item.taskId,
          applicationId: item.applicationId,
          studentName: item.studentName,
          studentCode: item.studentCode,
          criterion: item.criterion,
          targetLevel: item.targetLevel,
          status: item.status,
          aiConfidence: item.aiConfidence,
          riskLevel: item.riskLevel,
          dueDate: item.dueDate,
          updatedAt: item.updatedAt,
          permissions: item.permissions,
          priorityReason: item.priorityReason,
        })),
      bottleneckByCriterion,
      recentActivity,
    };
  }

  async listTasks(user: AuthenticatedUser, query: ListReviewTasksQuery) {
    const data = await this.reviewRepository.list(user, query);
    const items = [];
    const permissionCache: OfficerCriterionAccessCache = new Map();
    for (const task of data.items) {
      if (await this.canAccessTask(user, task, false, permissionCache)) {
        const item = toTaskListItem(task);
        const permissions = await this.getTaskPermissions(user, task, permissionCache);
        items.push({
          ...item,
          permissions,
          priorityReason: getTaskPriorityReason(item, permissions),
        });
      }
    }
    const filteredItems = query.riskLevel
      ? items.filter((item) => item.riskLevel === query.riskLevel)
      : items;
    const limit = query.pageSize ?? query.limit;

    return {
      items: filteredItems,
      pagination: {
        page: query.page,
        limit,
        total: query.riskLevel ? filteredItems.length : data.total,
        totalPages: Math.ceil((query.riskLevel ? filteredItems.length : data.total) / limit),
      },
    };
  }

  async getTaskDetail(user: AuthenticatedUser, taskId: string) {
    const task = await this.getTask(taskId);
    await this.assertTaskAccess(user, task, false);

    const taskForResponse = task;
    const permissions = await this.getTaskPermissions(user, taskForResponse);

    const evidences = taskForResponse.evidences.map((item) => item.evidence);
    const matchedEventIds = [
      ...new Set(
        evidences
          .map((evidence) => evidence.evidenceCard?.matchedEventId)
          .filter((eventId): eventId is string => Boolean(eventId)),
      ),
    ];
    const matchedEvents = matchedEventIds.length
      ? await prisma.eventRegistry.findMany({
          where: { id: { in: matchedEventIds }, ...workspaceFilterFor(user) },
          select: {
            id: true,
            eventName: true,
            organizer: true,
            organizerLevel: true,
            startDate: true,
            endDate: true,
          },
        })
      : [];
    const matchedEventsById = new Map(matchedEvents.map((event) => [event.id, event]));
    const knowledgeBaseMatches = await Promise.all(
      evidences.map(async (evidence) => ({
        evidenceId: evidence.id,
        matches: await prisma.knowledgeBaseItem.findMany({
          where: {
            ...workspaceFilterFor(user),
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
      task: toTaskDetail(taskForResponse, permissions),
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
      evidences: evidences.map((evidence) => {
        const fields =
          evidence.evidenceCard?.normalizedFieldsJson ?? evidence.evidenceCard?.extractedFieldsJson;
        const readableSummary = buildReadableSummary(fields);
        const displayEvent =
          evidence.event ??
          (evidence.evidenceCard?.matchedEventId
            ? matchedEventsById.get(evidence.evidenceCard.matchedEventId)
            : null);
        const fieldLayers = evidence.evidenceCard
          ? buildEvidenceCardFieldLayers({
              evidenceName: evidence.evidenceName,
              sourceType: evidence.sourceType,
              criterion: evidence.criterion,
              extractedFields: evidence.evidenceCard.extractedFieldsJson,
              normalizedFields: fields,
              matchedEventId: evidence.evidenceCard.matchedEventId,
              matchedParticipantId: evidence.evidenceCard.matchedParticipantId,
              warnings: evidence.evidenceCard.warningsJson,
              studentProfileFields: {
                studentName: taskForResponse.application?.student.fullName,
                studentCode: taskForResponse.application?.student.studentCode,
                className: taskForResponse.application?.student.className,
                faculty: taskForResponse.application?.student.faculty,
              },
              applicationMetrics:
                taskForResponse.application?.metrics.map((metric) => ({
                  metricType: metric.metricType,
                  value: metric.value,
                  scale: metric.scale,
                })) ?? [],
              targetLevel: taskForResponse.application?.targetLevel,
            })
          : null;

        return {
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
            uploadedAt: link.file.createdAt,
            createdAt: link.file.createdAt,
          })),
          card: evidence.evidenceCard
            ? {
                id: evidence.evidenceCard.id,
                ocrText: evidence.evidenceCard.ocrText,
                readableSummary,
                userProvidedFields: fieldLayers?.userProvidedFields,
                studentProfileFields: fieldLayers?.studentProfileFields,
                extractedFields: fieldLayers?.extractedFields,
                normalizedFields: fieldLayers?.normalizedFields,
                verifiedFields: fieldLayers?.verifiedFields,
                primaryFields: fieldLayers?.primaryFields,
                fieldConfidence: fieldLayers?.fieldConfidence,
                metricSuggestions: fieldLayers?.metricSuggestions,
                academic: fieldLayers?.academic,
                extractedFieldsJson: evidence.evidenceCard.extractedFieldsJson,
                normalizedFieldsJson: evidence.evidenceCard.normalizedFieldsJson,
                warningsJson: evidence.evidenceCard.warningsJson || [],
                matchedEventId: evidence.evidenceCard.matchedEventId,
                matchingStatus: {
                  code: evidence.evidenceCard.matchedEventId
                    ? 'official_match_found'
                    : 'official_match_not_found',
                  matchedEventId: evidence.evidenceCard.matchedEventId,
                  matchedEventName: displayEvent?.eventName ?? readableSummary.eventName ?? null,
                  matchedParticipantId: evidence.evidenceCard.matchedParticipantId,
                },
                matchedKnowledgeItemIds: evidence.evidenceCard.matchedKnowledgeItemIds,
                confidence: evidence.evidenceCard.confidence,
                aiSummary: evidence.evidenceCard.aiSummary,
                createdAt: evidence.evidenceCard.createdAt,
                updatedAt: evidence.evidenceCard.updatedAt,
              }
            : null,
          event: displayEvent
            ? {
                id: displayEvent.id,
                eventName: displayEvent.eventName,
                organizer: displayEvent.organizer,
                organizerLevel: displayEvent.organizerLevel,
                startDate: displayEvent.startDate,
                endDate: displayEvent.endDate,
              }
            : null,
        };
      }),
      precheck:
        taskForResponse.application?.precheckResults[0] ??
        taskForResponse.collectiveProfile?.precheckResults[0] ??
        null,
      cascade: taskForResponse.application?.cascadeReviews[0] ?? null,
      knowledgeBaseMatches,
      criteriaChecklist: buildCriteriaChecklist(taskForResponse),
      criterionLevelAssessment: buildCriterionLevelAssessment(taskForResponse),
      audit: auditLogs,
    };
  }

  async claimTask(user: AuthenticatedUser, taskId: string) {
    const task = await this.getTask(taskId);
    const permissions = await this.getTaskPermissions(user, task);

    if (!permissions.canClaim) {
      throw new AppError(403, ErrorCodes.REVIEW_TASK_PERMISSION_DENIED, permissions.reasonLabel);
    }

    const claimResult = await prisma.reviewTask.updateMany({
      where: { id: task.id, assignedOfficerId: null },
      data: {
        assignedOfficerId: user.id,
        status: task.status === ReviewTaskStatus.waiting ? ReviewTaskStatus.reviewing : task.status,
      },
    });

    if (claimResult.count === 0) {
      throw new AppError(
        409,
        ErrorCodes.CONFLICT,
        'Task này vừa được giao cho cán bộ khác. Bạn đang ở chế độ chỉ xem.',
      );
    }

    const updated = await prisma.reviewTask.findUniqueOrThrow({
      where: { id: task.id },
      include: reviewTaskListInclude,
    });
    const updatedItem = toTaskListItem(updated);
    const updatedPermissions = await this.getTaskPermissions(user, updated);

    await createApplicationAudit(prisma, {
      actorId: user.id,
      actorRole: user.role,
      action: auditActions.REVIEW_TASK_ASSIGNED,
      targetType: 'review_task',
      targetId: task.id,
      applicationId: task.applicationId,
      collectiveProfileId: task.collectiveProfileId,
      beforeStateJson: { assignedOfficerId: task.assignedOfficerId },
      afterStateJson: { assignedOfficerId: user.id, claimedByOfficer: true },
      note: 'Officer claimed an unassigned review task',
    });

    return {
      task: {
        ...updatedItem,
        permissions: updatedPermissions,
        priorityReason: getTaskPriorityReason(updatedItem, updatedPermissions),
      },
    };
  }

  async getCriterionLevelAssessment(user: AuthenticatedUser, taskId: string) {
    const task = await this.getTask(taskId);
    await this.assertTaskAccess(user, task, false);
    return buildCriterionLevelAssessment(task);
  }

  async getTaskTimeline(user: AuthenticatedUser, taskId: string) {
    const task = await this.getTask(taskId);
    await this.assertTaskAccess(user, task, false);

    const auditLogs = await prisma.auditLog.findMany({
      where: {
        OR: [
          { targetType: 'review_task', targetId: task.id },
          ...(task.applicationId ? [{ applicationId: task.applicationId }] : []),
          ...(task.collectiveProfileId ? [{ collectiveProfileId: task.collectiveProfileId }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 40,
    });

    const evidenceEvents = task.evidences.flatMap((item) => {
      const evidence = item.evidence;
      return [
        {
          id: `${evidence.id}-created`,
          action: 'EVIDENCE_CREATED',
          targetType: 'evidence',
          targetId: evidence.id,
          note: evidence.evidenceName,
          createdAt: evidence.createdAt,
        },
        ...evidence.evidenceFiles.map((link) => ({
          id: `${evidence.id}-${link.fileId}-uploaded`,
          action: 'EVIDENCE_FILE_UPLOADED',
          targetType: 'file',
          targetId: link.fileId,
          note: link.file.originalName,
          createdAt: link.file.createdAt,
        })),
      ];
    });

    return [...auditLogs, ...evidenceEvents].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  async decideTask(user: AuthenticatedUser, taskId: string, input: TaskDecisionInput) {
    const task = await this.getTask(taskId);
    await this.assertTaskAccess(user, task, true);
    const officerNote = input.officerNote ?? input.note;

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
      !officerNote
    ) {
      throw new AppError(
        400,
        ErrorCodes.DECISION_NOTE_REQUIRED,
        'Officer note is required for this decision',
      );
    }
    if (
      (input.decision === ReviewDecision.rejected ||
        input.decision === ReviewDecision.resolution_needed) &&
      (officerNote?.trim().length ?? 0) < 10
    ) {
      throw new AppError(
        400,
        ErrorCodes.DECISION_NOTE_REQUIRED,
        'Decision note must be at least 10 characters',
      );
    }
    if (input.decision === ReviewDecision.accepted && !input.officerSuggestedLevel) {
      throw new AppError(
        400,
        ErrorCodes.VALIDATION_ERROR,
        'officerSuggestedLevel is required when accepting a review task',
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
    for (const assessment of input.evidenceAssessments) {
      if (!linkedEvidenceIds.has(assessment.evidenceId)) {
        throw new AppError(
          400,
          ErrorCodes.VALIDATION_ERROR,
          `Evidence ${assessment.evidenceId} does not belong to this review task`,
        );
      }
      if (
        assessment.assessment !== 'valid' &&
        (!assessment.note || assessment.note.trim().length < 3)
      ) {
        throw new AppError(
          400,
          ErrorCodes.VALIDATION_ERROR,
          'Evidence assessment note is required for invalid, supplement, or ambiguous evidence',
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
    const precedentContext =
      input.decision === ReviewDecision.accepted
        ? await this.evidenceKnowledgeService.assertPrecedentUsableByOfficer(
            user,
            {
              precedentId: input.precedentId,
              precedentEventId: input.precedentEventId,
              precedentEvidenceId: input.precedentEvidenceId,
            },
            task.criterion,
          )
        : null;

    const result = await prisma.$transaction(async (tx) => {
      const status = mapDecisionToStatus(input.decision);
      const saved = await tx.reviewTask.update({
        where: { id: task.id },
        data: {
          status,
          decision: input.decision,
          officerNote,
          officerSuggestedLevel: input.officerSuggestedLevel ?? null,
          levelAssessmentJson: {
            ...(input.levelAssessmentJson ?? {}),
            evidenceAssessments: input.evidenceAssessments,
            submittedAt: new Date().toISOString(),
          } as Prisma.InputJsonValue,
          decisionReason: officerNote,
          supplementRequestJson:
            input.decision === ReviewDecision.supplement_required
              ? ((input.supplementRequestJson ?? { note: officerNote }) as Prisma.InputJsonValue)
              : undefined,
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
        let defaultEvidenceStatus: EvidenceStatus = EvidenceStatus.under_review;
        if (input.decision === ReviewDecision.accepted)
          defaultEvidenceStatus = EvidenceStatus.accepted;
        if (input.decision === ReviewDecision.rejected)
          defaultEvidenceStatus = EvidenceStatus.rejected;
        if (input.decision === ReviewDecision.supplement_required)
          defaultEvidenceStatus = EvidenceStatus.needs_supplement;
        if (input.decision === ReviewDecision.resolution_needed)
          defaultEvidenceStatus = EvidenceStatus.resolution_needed;

        await tx.evidence.updateMany({
          where: { id: { in: evidenceIds } },
          data: { status: defaultEvidenceStatus },
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

      if (input.decision === ReviewDecision.accepted) {
        const acceptedEvidenceIds = input.evidenceDecisions.length
          ? input.evidenceDecisions
              .filter((item) => item.status === EvidenceStatus.accepted)
              .map((item) => item.evidenceId)
          : evidenceIds;
        for (const evidenceId of acceptedEvidenceIds) {
          await this.evidenceKnowledgePublisher.publishAcceptedEvidence(tx, user, {
            evidenceId,
            reviewTaskId: task.id,
            approvalSource: ApprovedEvidenceApprovalSource.officer,
            note: officerNote,
          });
        }
      }

      if (input.decision === ReviewDecision.supplement_required) {
        const supplementRequest = (input.supplementRequestJson ?? {}) as Record<string, unknown>;
        const selectedEvidenceIds = input.evidenceDecisions.length
          ? input.evidenceDecisions.map((item) => item.evidenceId)
          : evidenceIds;
        const primaryEvidenceId = selectedEvidenceIds[0] ?? null;
        await tx.application.update({
          where: { id: applicationId },
          data: { status: ApplicationStatus.supplement_required },
        });
        const notification = await this.notificationsService.create(
          {
            userId: application.studentId,
            applicationId,
            evidenceId: primaryEvidenceId,
            reviewTaskId: task.id,
            metadata: {
              criterion: task.criterion,
              evidenceIds: selectedEvidenceIds,
              deadline: supplementRequest.deadline ?? null,
              requestedFields: supplementRequest.requestedFields ?? [],
            },
            type: NotificationType.supplement_required,
            title: 'Cần bổ sung minh chứng',
            message: officerNote ?? 'Hồ sơ cần bổ sung minh chứng.',
          },
          tx,
        );
        await this.emailOutboxService.enqueue(
          {
            recipientEmail: application.student.email,
            recipientName: application.student.fullName,
            relatedUserId: application.studentId,
            applicationId,
            notificationId: notification.id,
            templateKey: 'supplement_requested',
            payload: {
              studentName: application.student.fullName,
              recipientName: application.student.fullName,
              applicationCode: applicationId,
              applicationId,
              schoolYear: application.schoolYear,
              targetLevel: application.targetLevel,
              criterion: task.criterion,
              criterionName: task.criterion,
              deadline: readSupplementDeadline(input.supplementRequestJson),
              reason: officerNote,
              reviewNote: officerNote,
              supplementSummary: buildSupplementSummary(input.supplementRequestJson, officerNote),
            },
            dedupeKey: buildEmailDedupeKey('supplement_requested', {
              applicationId,
              reviewTaskId: task.id,
              criterion: task.criterion,
              supplementRequestJson: input.supplementRequestJson ?? null,
              officerNote,
            }),
            actorId: user.id,
            actorRole: user.role,
          },
          tx,
        );
      }

      if (input.decision === ReviewDecision.resolution_needed) {
        const selectedEvidenceIds = input.evidenceDecisions.length
          ? input.evidenceDecisions.map((item) => item.evidenceId)
          : evidenceIds;
        const primaryEvidenceId = selectedEvidenceIds[0] ?? null;
        await tx.application.update({
          where: { id: applicationId },
          data: { status: ApplicationStatus.resolution_needed },
        });

        const existingCase = await tx.resolutionCase.findFirst({
          where: {
            applicationId,
            status: { in: ['open', 'in_review'] },
            OR: [
              { reviewTaskId: task.id },
              ...(selectedEvidenceIds.length > 0
                ? [{ evidenceId: { in: selectedEvidenceIds } }]
                : [{ reviewTaskId: null, evidenceId: null }]),
            ],
          },
          orderBy: { createdAt: 'desc' },
        });
        let resolutionCaseId = existingCase?.id ?? null;
        if (
          existingCase &&
          (!existingCase.reviewTaskId || (primaryEvidenceId && !existingCase.evidenceId))
        ) {
          await tx.resolutionCase.update({
            where: { id: existingCase.id },
            data: {
              reviewTaskId: existingCase.reviewTaskId ?? task.id,
              evidenceId: existingCase.evidenceId ?? primaryEvidenceId,
            },
          });
        } else if (!existingCase) {
          const createdCase = await tx.resolutionCase.create({
            data: {
              applicationId,
              workspaceId: task.workspaceId,
              evidenceId: primaryEvidenceId,
              reviewTaskId: task.id,
              reason: officerNote ?? 'Cần hội đồng xem xét.',
              createdBy: user.id,
              status: 'open',
            },
          });
          resolutionCaseId = createdCase.id;
        }

        await this.notificationsService.create(
          {
            userId: application.studentId,
            workspaceId: task.workspaceId,
            applicationId,
            evidenceId: primaryEvidenceId,
            reviewTaskId: task.id,
            resolutionCaseId,
            metadata: {
              criterion: task.criterion,
              evidenceIds: selectedEvidenceIds,
              primaryEvidenceId,
              resolutionCaseId,
            },
            type: NotificationType.review_updated,
            title: 'Hồ sơ được chuyển hội đồng xem xét',
            message: officerNote ?? 'Một tiêu chí cần hội đồng xem xét.',
          },
          tx,
        );
        await notifyManagers(
          tx,
          applicationId,
          resolutionCaseId,
          'Có hồ sơ cần xử lý đối sánh',
          officerNote ?? 'Một task được chuyển sang cần hội đồng xem xét.',
          {
            reviewTaskId: task.id,
            criterion: task.criterion,
            evidenceIds: selectedEvidenceIds,
            primaryEvidenceId,
            resolutionCaseId,
          },
        );
      }

      const applicationOutcome = await syncApplicationReviewOutcome(tx, applicationId);

      // Audit application status changes
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: 'APPLICATION_STATUS_UPDATED',
        targetType: 'application',
        targetId: applicationId,
        applicationId,
        beforeStateJson: {
          status: application.status,
          finalStatus: application.finalStatus,
          finalLevel: application.finalLevel,
        },
        afterStateJson: applicationOutcome
          ? {
              status: applicationOutcome.status,
              finalStatus: applicationOutcome.finalStatus,
              finalLevel: applicationOutcome.finalLevel,
            }
          : { status: application.status },
      });

      let auditActionName = 'REVIEW_DECISION_ACCEPTED';
      if (input.decision === ReviewDecision.rejected) auditActionName = 'REVIEW_DECISION_REJECTED';
      if (input.decision === ReviewDecision.supplement_required)
        auditActionName = 'REVIEW_SUPPLEMENT_REQUESTED';
      if (input.decision === ReviewDecision.resolution_needed)
        auditActionName = 'REVIEW_ESCALATED_TO_RESOLUTION';

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActionName,
        targetType: 'review_task',
        targetId: task.id,
        applicationId,
        afterStateJson: {
          status,
          decision: input.decision,
          officerSuggestedLevel: input.officerSuggestedLevel ?? null,
          evidenceAssessments: input.evidenceAssessments,
        },
        note: officerNote,
      });

      if (precedentContext) {
        await createApplicationAudit(tx, {
          actorId: user.id,
          actorRole: user.role,
          action: 'REVIEW_ACCEPTED_WITH_PRECEDENT',
          targetType: 'review_task',
          targetId: task.id,
          applicationId,
          afterStateJson: {
            decision: input.decision,
            precedentId: precedentContext.precedentId,
            precedentEventId: precedentContext.precedentEventId,
            precedentEvidenceId: precedentContext.precedentEvidenceId,
          },
          note: officerNote,
        });
      }

      if (
        input.decision !== ReviewDecision.supplement_required &&
        input.decision !== ReviewDecision.resolution_needed
      ) {
        const notification = await this.notificationsService.create(
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
        if (resultStatusIsRejected(applicationOutcome?.status)) {
          await this.emailOutboxService.enqueue(
            {
              recipientEmail: application.student.email,
              recipientName: application.student.fullName,
              relatedUserId: application.studentId,
              applicationId,
              notificationId: notification.id,
              templateKey: 'application_rejected',
              payload: {
                studentName: application.student.fullName,
                recipientName: application.student.fullName,
                applicationCode: applicationId,
                applicationId,
                schoolYear: application.schoolYear,
                targetLevel: application.targetLevel,
                status: ApplicationStatus.rejected,
                reason: officerNote,
                reviewNote: officerNote,
              },
              dedupeKey: buildEmailDedupeKey('application_rejected', {
                applicationId,
                reviewTaskId: task.id,
                status: ApplicationStatus.rejected,
                decision: input.decision,
              }),
              actorId: user.id,
              actorRole: user.role,
            },
            tx,
          );
        }
      }

      return { task: saved, applicationOutcome };
    });

    return {
      task: result.task,
      application: {
        id: applicationId,
        status:
          input.decision === ReviewDecision.supplement_required
            ? ApplicationStatus.supplement_required
            : input.decision === ReviewDecision.resolution_needed
              ? ApplicationStatus.resolution_needed
              : (result.applicationOutcome?.status ?? application.status),
        finalStatus: result.applicationOutcome?.finalStatus ?? application.finalStatus,
        finalLevel: result.applicationOutcome?.finalLevel ?? application.finalLevel,
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
      status: EvidenceStatus.needs_supplement,
    }));

    const result = await this.decideTask(user, taskId, {
      decision: ReviewDecision.supplement_required,
      officerNote: input.reason,
      evidenceDecisions,
      evidenceAssessments: [],
      supplementRequestJson: {
        reason: input.reason,
        deadline: input.deadline ?? null,
        evidenceIds: input.evidenceIds ?? [],
        requestedFields: input.requestedFields ?? [],
      },
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

    return {
      ...result,
      notificationCreated: true,
      supplementRequest: {
        reason: input.reason,
        deadline: input.deadline ?? null,
        evidenceIds: input.evidenceIds ?? [],
        requestedFields: input.requestedFields ?? [],
      },
    };
  }

  async escalateResolution(
    user: AuthenticatedUser,
    taskId: string,
    input: {
      reason: string;
      evidenceId?: string;
      evidenceIds?: string[];
      priority?: string;
      precedentGuardViewed?: boolean;
      precedentGuardReason?: string;
      precedentId?: string;
    },
  ) {
    const selectedEvidenceIds =
      input.evidenceIds && input.evidenceIds.length > 0
        ? input.evidenceIds
        : input.evidenceId
          ? [input.evidenceId]
          : [];
    const evidenceDecisions = selectedEvidenceIds.map((id) => ({
      evidenceId: id,
      status: EvidenceStatus.resolution_needed,
    }));

    const result = await this.decideTask(user, taskId, {
      decision: ReviewDecision.resolution_needed,
      officerNote: input.reason,
      evidenceDecisions,
      evidenceAssessments: [],
    });

    await createApplicationAudit(prisma, {
      actorId: user.id,
      actorRole: user.role,
      action: 'REVIEW_ESCALATED_TO_RESOLUTION',
      targetType: 'review_task',
      targetId: taskId,
      applicationId: result.application?.id,
      afterStateJson: {
        evidenceIds: selectedEvidenceIds,
        priority: input.priority || 'normal',
        precedentGuardViewed: input.precedentGuardViewed ?? false,
        precedentGuardReason: input.precedentGuardReason ?? null,
        precedentId: input.precedentId ?? null,
      },
      note: input.reason,
    });

    return result;
  }

  async checkPrecedents(
    user: AuthenticatedUser,
    taskId: string,
    query: ReviewTaskPrecedentCheckQuery,
  ) {
    const task = await this.getTask(taskId);
    await this.assertTaskAccess(user, task, false);
    return this.evidenceKnowledgeService.searchForReviewTask(user, task, query);
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
    assertSameWorkspace(user, task, 'Review task not found');
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
    permissionCache?: OfficerCriterionAccessCache,
  ): Promise<boolean> {
    const permissions = await this.getTaskPermissions(user, task, permissionCache);
    return decision ? permissions.canAct : permissions.canView;
  }

  private async getTaskPermissions(
    user: AuthenticatedUser,
    task: {
      assignedOfficerId: string | null;
      status: ReviewTaskStatus;
      criterion: Criterion;
      application: { student: { faculty: string | null } } | null;
      collectiveProfile: { representative: { faculty: string | null } } | null;
    },
    permissionCache?: OfficerCriterionAccessCache,
  ): Promise<ReviewTaskPermissions> {
    const final = isFinalReviewTaskStatus(task.status);

    if (user.role === Role.manager || user.role === Role.admin) {
      return buildTaskPermissions({
        canView: true,
        canAct: true,
        canClaim: false,
        canRequestSupport: false,
        reason: 'manager_full_access',
      });
    }

    if (user.role === Role.committee) {
      const canView = task.status === ReviewTaskStatus.resolution_needed;
      return buildTaskPermissions({
        canView,
        canAct: false,
        canClaim: false,
        canRequestSupport: false,
        reason: canView ? 'committee_resolution_view' : 'out_of_scope',
      });
    }

    if (user.role !== Role.officer) {
      return buildTaskPermissions({
        canView: false,
        canAct: false,
        canClaim: false,
        canRequestSupport: false,
        reason: 'role_not_allowed',
      });
    }

    const faculty =
      task.application?.student.faculty ?? task.collectiveProfile?.representative.faculty;
    const specialized = await this.canOfficerHandleCriterion(
      user,
      task.criterion,
      faculty,
      permissionCache,
    );

    if (task.assignedOfficerId === user.id) {
      return buildTaskPermissions({
        canView: true,
        canAct: !final,
        canClaim: false,
        canRequestSupport: false,
        reason: final ? 'finalized' : 'assigned_to_you',
      });
    }

    if (!task.assignedOfficerId && specialized) {
      return buildTaskPermissions({
        canView: true,
        canAct: false,
        canClaim: !final,
        canRequestSupport: false,
        reason: final ? 'finalized' : 'claimable_by_specialization',
      });
    }

    if (task.assignedOfficerId && specialized) {
      return buildTaskPermissions({
        canView: true,
        canAct: false,
        canClaim: false,
        canRequestSupport: true,
        reason: final ? 'finalized' : 'assigned_to_other',
      });
    }

    return buildTaskPermissions({
      canView: false,
      canAct: false,
      canClaim: false,
      canRequestSupport: false,
      reason: 'out_of_scope',
    });
  }

  private async canOfficerHandleCriterion(
    user: AuthenticatedUser,
    criterion: Criterion,
    faculty: string | null | undefined,
    permissionCache?: OfficerCriterionAccessCache,
  ): Promise<boolean> {
    if (!permissionCache) {
      return this.assignmentService.canOfficerHandleCriterion(user.id, criterion, faculty);
    }

    const key = `${user.id}:${criterion}:${faculty ?? ''}`;
    const cached = permissionCache.get(key);
    if (cached) return cached;

    const result = this.assignmentService.canOfficerHandleCriterion(user.id, criterion, faculty);
    permissionCache.set(key, result);
    return result;
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

    const allowedStatuses = [
      'submitted',
      'under_review',
      'supplement_required',
      'resolution_needed',
    ];
    if (application.status === 'draft') {
      throw new AppError(
        400,
        ErrorCodes.INVALID_APPLICATION_STATUS,
        'Cannot ensure tasks for draft application',
      );
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

    const criteriaToCreate = Array.from(criteriaToEnsure).filter((c) => !existingCriteria.has(c));

    const createdTasks: Prisma.ReviewTaskGetPayload<object>[] = [];

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
            workspaceId: application.workspaceId,
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

async function syncApplicationReviewOutcome(tx: Prisma.TransactionClient, applicationId: string) {
  const tasks = await tx.reviewTask.findMany({
    where: { applicationId },
    select: { status: true, officerSuggestedLevel: true },
  });

  if (tasks.length === 0) {
    return null;
  }

  const now = new Date();
  const baseData: Prisma.ApplicationUpdateInput = {
    finalizedAt: null,
    finalizedBy: { disconnect: true },
    finalStatus: FinalStatus.pending,
    finalLevel: null,
    finalNote: null,
  };

  if (tasks.some((task) => task.status === ReviewTaskStatus.supplement_required)) {
    return tx.application.update({
      where: { id: applicationId },
      data: { ...baseData, status: ApplicationStatus.supplement_required },
      select: { status: true, finalStatus: true, finalLevel: true },
    });
  }

  if (tasks.some((task) => task.status === ReviewTaskStatus.resolution_needed)) {
    return tx.application.update({
      where: { id: applicationId },
      data: { ...baseData, status: ApplicationStatus.resolution_needed },
      select: { status: true, finalStatus: true, finalLevel: true },
    });
  }

  if (
    tasks.some(
      (task) =>
        task.status === ReviewTaskStatus.waiting || task.status === ReviewTaskStatus.reviewing,
    )
  ) {
    return tx.application.update({
      where: { id: applicationId },
      data: { ...baseData, status: ApplicationStatus.under_review },
      select: { status: true, finalStatus: true, finalLevel: true },
    });
  }

  if (tasks.every((task) => task.status === ReviewTaskStatus.accepted)) {
    return tx.application.update({
      where: { id: applicationId },
      data: { ...baseData, status: ApplicationStatus.under_review },
      select: { status: true, finalStatus: true, finalLevel: true },
    });
  }

  if (
    tasks.every(
      (task) =>
        task.status === ReviewTaskStatus.accepted || task.status === ReviewTaskStatus.rejected,
    )
  ) {
    return tx.application.update({
      where: { id: applicationId },
      data: {
        status: ApplicationStatus.rejected,
        finalStatus: FinalStatus.failed,
        finalLevel: null,
        finalizedAt: now,
        finalNote: 'Auto-closed after at least one review criterion was rejected.',
      },
      select: { status: true, finalStatus: true, finalLevel: true },
    });
  }

  return null;
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
          type: NotificationType.review_updated,
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
  officerSuggestedLevel?: Level | null;
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
  evidences?: Array<{
    evidence: {
      status: EvidenceStatus;
      confidence: number | null;
      evidenceCard: { confidence: number | null; warningsJson: Prisma.JsonValue | null } | null;
    };
  }>;
  _count: { evidences: number };
}) {
  const aiConfidence = getTaskAiConfidence(task.evidences ?? []);
  const targetLevel =
    task.application?.targetLevel ?? task.collectiveProfile?.targetLevel ?? 'school';
  const riskLevel = getTaskRiskLevel({
    status: task.status,
    dueDate: task.dueDate,
    targetLevel: targetLevel as Level,
    aiConfidence,
    evidences: task.evidences ?? [],
  });
  const evidenceSupplementCount =
    task.evidences?.filter((item) => item.evidence.status === EvidenceStatus.needs_supplement)
      .length ?? 0;

  return {
    id: task.id,
    taskId: task.id,
    applicationId: task.application?.id ?? task.collectiveProfile?.id ?? '',
    studentName:
      task.application?.student.fullName ??
      task.collectiveProfile?.representative.fullName ??
      task.collectiveProfile?.className ??
      '',
    studentCode: task.application?.student.studentCode ?? '',
    className: task.application?.student.className ?? task.collectiveProfile?.className ?? null,
    faculty:
      task.application?.student.faculty ?? task.collectiveProfile?.representative.faculty ?? null,
    schoolYear: task.application?.schoolYear ?? task.collectiveProfile?.schoolYear ?? '',
    targetLevel,
    applicationStatus: task.application?.status ?? task.collectiveProfile?.status ?? null,
    criterion: task.criterion,
    status: task.status,
    decision: task.decision,
    dueDate: task.dueDate,
    aiConfidence,
    riskLevel,
    supplementCount: evidenceSupplementCount,
    officerSuggestedLevel: task.officerSuggestedLevel ?? null,
    assignedOfficerId: task.assignedOfficer?.id ?? null,
    assignedOfficerName: task.assignedOfficer?.fullName ?? null,
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

function toTaskDetail(
  task: NonNullable<Awaited<ReturnType<ReviewRepository['findDetail']>>>,
  permissions?: ReviewTaskPermissions,
) {
  return {
    id: task.id,
    criterion: task.criterion,
    status: task.status,
    decision: task.decision,
    officerNote: task.officerNote,
    officerSuggestedLevel: task.officerSuggestedLevel,
    levelAssessmentJson: task.levelAssessmentJson,
    decisionReason: task.decisionReason,
    supplementRequestJson: task.supplementRequestJson,
    assignedOfficer: task.assignedOfficer,
    permissions,
    dueDate: task.dueDate,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function isFinalReviewTaskStatus(status: ReviewTaskStatus) {
  return (
    status === ReviewTaskStatus.accepted ||
    status === ReviewTaskStatus.rejected ||
    status === ReviewTaskStatus.resolution_needed
  );
}

function buildTaskPermissions(
  input: Omit<ReviewTaskPermissions, 'reasonLabel' | 'badges' | 'availableActions'>,
) {
  return {
    ...input,
    reasonLabel: taskPermissionReasonLabel(input.reason),
    badges: buildPermissionBadges(input),
    availableActions: buildAvailableActions(input),
  };
}

function buildPermissionBadges(
  input: Omit<ReviewTaskPermissions, 'reasonLabel' | 'badges' | 'availableActions'>,
) {
  if (input.reason === 'finalized') return ['Đã chốt'];
  if (input.canAct) return ['Được xử lý'];
  if (input.canClaim) return ['Có thể nhận'];
  if (input.canView) return ['Chỉ xem'];
  return ['Không có quyền'];
}

function buildAvailableActions(
  input: Omit<ReviewTaskPermissions, 'reasonLabel' | 'badges' | 'availableActions'>,
): ReviewTaskAvailableAction[] {
  const actions: ReviewTaskAvailableAction[] = [];
  if (input.canView) actions.push('view');
  if (input.canAct) actions.push('decide', 'request_supplement', 'escalate_resolution');
  if (input.canClaim) actions.push('claim');
  if (input.canRequestSupport) actions.push('request_support');
  return actions;
}

function taskPermissionReasonLabel(reason: ReviewTaskPermissionReason) {
  const labels: Record<ReviewTaskPermissionReason, string> = {
    manager_full_access: 'Hội đồng/Cấp quản lý được xem và xử lý task này.',
    committee_resolution_view: 'Task đang ở trạng thái hội ý, được xem ở chế độ theo dõi.',
    assigned_to_you: 'Task được giao cho bạn.',
    claimable_by_specialization: 'Task chưa phân công và thuộc tiêu chí bạn phụ trách.',
    assigned_to_other: 'Task đã được giao cho cán bộ khác, bạn chỉ được xem.',
    finalized: 'Task đã có kết luận, chỉ được xem lại.',
    out_of_scope: 'Task không thuộc phạm vi phụ trách của bạn.',
    role_not_allowed: 'Tài khoản hiện tại không có quyền xem task xét duyệt.',
  };

  return labels[reason];
}

function metricForCriterion(criterion: Criterion) {
  if (criterion === 'academic') return 'gpa';
  if (criterion === 'ethics') return 'conduct_score';
  if (criterion === 'physical') return 'physical_score';
  if (criterion === 'volunteer') return 'volunteer_days';
  if (criterion === 'integration') return 'foreign_language_score';
  return undefined;
}

function buildCriteriaChecklist(
  task: NonNullable<Awaited<ReturnType<ReviewRepository['findDetail']>>>,
) {
  return buildCriterionLevelAssessment(task).levels.flatMap((level) =>
    level.requirements.map((requirement) => ({
      id: `${level.level}-${requirement.key}`,
      label: `${levelLabel(level.level)} - ${requirement.label}`,
      passed:
        requirement.status === 'passed' ? true : requirement.status === 'failed' ? false : null,
      required: true,
      note: requirement.reason,
    })),
  );
}

function buildCriterionLevelAssessment(
  task: NonNullable<Awaited<ReturnType<ReviewRepository['findDetail']>>>,
) {
  const levels = [Level.school, Level.university, Level.city, Level.central].map((level) => {
    const requirements = buildLevelRequirements(task, level);
    const status = summarizeRequirementStatus(requirements);
    return {
      level,
      status,
      score: scoreForStatus(status),
      requirements,
      summary: levelSummary(level, status),
    };
  });
  const passed = levels.filter((level) => level.status === 'passed');

  return {
    taskId: task.id,
    criterion: task.criterion,
    targetLevel: task.application?.targetLevel ?? task.collectiveProfile?.targetLevel ?? null,
    levels,
    suggestedCriterionLevel: passed.at(-1)?.level ?? null,
    humanConfirmationRequired: true,
  };
}

function buildLevelRequirements(
  task: NonNullable<Awaited<ReturnType<ReviewRepository['findDetail']>>>,
  level: Level,
) {
  const metricType = metricForCriterion(task.criterion);
  const metric = metricType
    ? task.application?.metrics.find((item) => item.metricType === metricType)
    : null;
  const threshold = metricThreshold(task.criterion, level);
  const evidences = task.evidences.map((item) => item.evidence);
  const indexedEvidence = evidences.filter(
    (evidence) =>
      evidence.indexingStatus === 'indexed' ||
      evidence.status === EvidenceStatus.accepted ||
      evidence.sourceType === 'event_import',
  );
  const lowConfidenceEvidence = evidences.some(
    (evidence) => (evidence.evidenceCard?.confidence ?? evidence.confidence ?? 1) < 0.7,
  );
  const warnings = evidences.flatMap((evidence) => jsonArray(evidence.evidenceCard?.warningsJson));
  const requirements: Array<{
    key: string;
    label: string;
    status: RequirementStatus;
    actualValue: string | null;
    requiredValue: string;
    source: string;
    reason: string;
  }> = [];

  if (threshold !== null) {
    requirements.push({
      key: metricType ?? 'metric',
      label: metricLabel(task.criterion),
      status: metric ? (metric.value >= threshold ? 'passed' : 'failed') : 'missing',
      actualValue: metric ? String(metric.value) : null,
      requiredValue: `>= ${threshold}`,
      source: 'application_metrics',
      reason: metric
        ? metric.value >= threshold
          ? `${metricLabel(task.criterion)} đạt ngưỡng ${levelLabel(level)}`
          : `${metricLabel(task.criterion)} chưa đạt ngưỡng ${levelLabel(level)}`
        : `Chưa có dữ liệu ${metricLabel(task.criterion)}`,
    });
  }

  requirements.push({
    key: 'evidence',
    label: 'Có minh chứng phù hợp',
    status:
      evidences.length === 0
        ? 'missing'
        : indexedEvidence.length > 0 && !lowConfidenceEvidence
          ? 'passed'
          : 'needs_review',
    actualValue: String(indexedEvidence.length || evidences.length),
    requiredValue: '>= 1 minh chứng',
    source: 'evidences',
    reason:
      evidences.length === 0
        ? 'Chưa có minh chứng cho tiêu chí'
        : lowConfidenceEvidence
          ? 'Có minh chứng AI confidence thấp, cần cán bộ xác nhận'
          : 'Có minh chứng để đối chiếu',
  });

  if (warnings.length > 0) {
    requirements.push({
      key: 'warnings',
      label: 'Cảnh báo AI / OCR',
      status: 'needs_review',
      actualValue: `${warnings.length} cảnh báo`,
      requiredValue: 'Không có cảnh báo chặn',
      source: 'evidence_cards',
      reason: 'AI/OCR phát hiện cảnh báo, cán bộ cần kiểm tra thủ công',
    });
  }

  if (task.criterion === Criterion.academic && level !== Level.school) {
    requirements.push({
      key: 'academic_achievement',
      label: 'Minh chứng thành tích học thuật/NCKH',
      status: evidences.some((evidence) => /nckh|giải|khen|olympic/i.test(evidence.evidenceName))
        ? 'passed'
        : 'needs_review',
      actualValue: null,
      requiredValue: 'Có minh chứng thành tích nếu xét cấp cao',
      source: 'evidences',
      reason: 'Cấp cao cần cán bộ đối chiếu thêm thành tích học thuật nếu quy định yêu cầu',
    });
  }

  return requirements;
}

function summarizeRequirementStatus(requirements: Array<{ status: RequirementStatus }>) {
  if (requirements.some((item) => item.status === 'failed')) return 'failed';
  if (requirements.some((item) => item.status === 'missing')) return 'missing';
  if (requirements.some((item) => item.status === 'needs_review')) return 'needs_review';
  return 'passed';
}

function scoreForStatus(status: string) {
  if (status === 'passed') return 100;
  if (status === 'needs_review') return 60;
  if (status === 'missing') return 30;
  return 0;
}

function metricThreshold(criterion: Criterion, level: Level) {
  const table: Partial<Record<Criterion, Record<Level, number>>> = {
    academic: { school: 3, university: 3.2, city: 3.4, central: 3.6 },
    ethics: { school: 80, university: 85, city: 90, central: 90 },
    physical: { school: 70, university: 75, city: 80, central: 85 },
    volunteer: { school: 3, university: 5, city: 7, central: 10 },
    integration: { school: 1, university: 1, city: 1, central: 1 },
  };
  return table[criterion]?.[level] ?? null;
}

function metricLabel(criterion: Criterion) {
  if (criterion === Criterion.academic) return 'GPA';
  if (criterion === Criterion.ethics) return 'Điểm rèn luyện';
  if (criterion === Criterion.physical) return 'Điểm/thành tích thể lực';
  if (criterion === Criterion.volunteer) return 'Số ngày tình nguyện';
  if (criterion === Criterion.integration) return 'Minh chứng hội nhập';
  return 'Chỉ số tiêu chí';
}

function levelLabel(level: Level) {
  const labels: Record<Level, string> = {
    school: 'Cấp Trường',
    university: 'Cấp ĐHĐN',
    city: 'Cấp Thành phố',
    central: 'Cấp Trung ương',
  };
  return labels[level];
}

function levelSummary(level: Level, status: string) {
  if (status === 'passed') return `Có thể đạt ${levelLabel(level)}`;
  if (status === 'failed') return `Chưa đạt ${levelLabel(level)}`;
  if (status === 'missing') return `Thiếu dữ liệu để xét ${levelLabel(level)}`;
  return `Cần cán bộ xác nhận ${levelLabel(level)}`;
}

function jsonArray(value: Prisma.JsonValue | null | undefined): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readSupplementDeadline(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const deadline = (value as { deadline?: unknown }).deadline;
  return typeof deadline === 'string' && deadline.trim() ? deadline : undefined;
}

function buildSupplementSummary(value: unknown, fallback?: string | null): string | undefined {
  const parts: string[] = [];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const request = value as {
      requestedFields?: unknown;
      reason?: unknown;
      note?: unknown;
      summary?: unknown;
    };
    if (typeof request.summary === 'string' && request.summary.trim()) {
      parts.push(request.summary.trim());
    }
    if (Array.isArray(request.requestedFields) && request.requestedFields.length > 0) {
      const fields = request.requestedFields
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim());
      if (fields.length > 0) {
        parts.push(`Các mục cần bổ sung/làm rõ: ${fields.join(', ')}`);
      }
    }
    for (const item of [request.reason, request.note]) {
      if (typeof item === 'string' && item.trim()) parts.push(item.trim());
    }
  }
  if (parts.length > 0) return Array.from(new Set(parts)).join('\n');
  return fallback?.trim() || undefined;
}

function resultStatusIsRejected(status: ApplicationStatus | undefined): boolean {
  return status === ApplicationStatus.rejected;
}

function getTaskAiConfidence(
  evidences: Array<{
    evidence: { confidence: number | null; evidenceCard: { confidence: number | null } | null };
  }>,
) {
  const values = evidences
    .map((item) => item.evidence.evidenceCard?.confidence ?? item.evidence.confidence)
    .filter((value): value is number => typeof value === 'number');
  if (!values.length) return null;
  return Math.min(...values);
}

function getTaskRiskLevel(input: {
  status: ReviewTaskStatus;
  dueDate: Date | null;
  targetLevel: Level;
  aiConfidence: number | null;
  evidences: Array<{
    evidence: {
      status: EvidenceStatus;
      evidenceCard: { warningsJson: Prisma.JsonValue | null } | null;
    };
  }>;
}): RiskLevel {
  const now = Date.now();
  const due = input.dueDate?.getTime();
  const hasWarnings = input.evidences.some(
    (item) => jsonArray(item.evidence.evidenceCard?.warningsJson).length > 0,
  );
  if (
    input.status === ReviewTaskStatus.resolution_needed ||
    (due !== undefined && due < now) ||
    (input.aiConfidence !== null && input.aiConfidence < 0.55) ||
    input.targetLevel === Level.central
  ) {
    return 'high';
  }
  if (
    input.status === ReviewTaskStatus.supplement_required ||
    (due !== undefined && due <= now + 3 * 24 * 60 * 60 * 1000) ||
    (input.aiConfidence !== null && input.aiConfidence < 0.7) ||
    hasWarnings ||
    input.targetLevel === Level.city
  ) {
    return 'medium';
  }
  return 'low';
}

function comparePriorityTasks(
  a: ReturnType<typeof toTaskListItem> & { priorityReason?: ReviewTaskPriorityReason },
  b: ReturnType<typeof toTaskListItem> & { priorityReason?: ReviewTaskPriorityReason },
) {
  const priorityReasonWeight: Record<Exclude<ReviewTaskPriorityReason, null>, number> = {
    overdue: 0,
    student_resubmitted: 1,
    low_ai_confidence: 2,
    due_soon: 3,
    assigned_to_you: 4,
    unassigned_claimable: 5,
  };
  const riskWeight: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 };
  const levelWeight: Record<string, number> = { central: 0, city: 1, university: 2, school: 3 };
  const aPriority = a.priorityReason ? priorityReasonWeight[a.priorityReason] : 99;
  const bPriority = b.priorityReason ? priorityReasonWeight[b.priorityReason] : 99;
  if (aPriority !== bPriority) return aPriority - bPriority;
  const now = Date.now();
  const aOverdue = a.dueDate && new Date(a.dueDate).getTime() < now ? 0 : 1;
  const bOverdue = b.dueDate && new Date(b.dueDate).getTime() < now ? 0 : 1;
  if (aOverdue !== bOverdue) return aOverdue - bOverdue;
  if (riskWeight[a.riskLevel] !== riskWeight[b.riskLevel]) {
    return riskWeight[a.riskLevel] - riskWeight[b.riskLevel];
  }
  const aConfidence = a.aiConfidence ?? 1;
  const bConfidence = b.aiConfidence ?? 1;
  if (aConfidence !== bConfidence) return aConfidence - bConfidence;
  if (levelWeight[a.targetLevel] !== levelWeight[b.targetLevel]) {
    return levelWeight[a.targetLevel] - levelWeight[b.targetLevel];
  }
  return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
}

function getTaskPriorityReason(
  item: ReturnType<typeof toTaskListItem>,
  permissions: ReviewTaskPermissions,
): ReviewTaskPriorityReason {
  const dueAt = item.dueDate ? new Date(item.dueDate).getTime() : null;
  const now = Date.now();
  const active = !isFinalReviewTaskStatus(item.status);

  if (active && dueAt !== null && dueAt < now) return 'overdue';
  if (active && item.aiConfidence !== null && item.aiConfidence < 0.7) {
    return 'low_ai_confidence';
  }
  if (active && dueAt !== null && dueAt <= now + 3 * 24 * 60 * 60 * 1000) {
    return 'due_soon';
  }
  if (active && permissions.reason === 'assigned_to_you' && permissions.canAct)
    return 'assigned_to_you';
  if (active && permissions.reason === 'claimable_by_specialization' && permissions.canClaim)
    return 'unassigned_claimable';
  return null;
}

function isActionablePriorityTask(
  item: ReturnType<typeof toTaskListItem> & {
    permissions: ReviewTaskPermissions;
    priorityReason?: ReviewTaskPriorityReason;
  },
) {
  if (isFinalReviewTaskStatus(item.status)) return false;
  return Boolean(item.priorityReason || item.permissions.canAct || item.permissions.canClaim);
}

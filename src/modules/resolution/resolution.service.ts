// Owns committee resolution cases and final dispute decisions.
import {
  ApplicationStatus,
  Criterion,
  EvidenceStatus,
  KnowledgeDecision,
  NotificationType,
  ResolutionStatus,
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
import { createNotification } from '../notifications/notifications.service';
import type {
  ListResolutionCasesQuery,
  ReopenResolutionCaseInput,
  ResolutionDecisionInput,
  ResolutionStatusUpdateInput,
} from './resolution.validation';

const resolutionInclude = {
  application: { include: { student: true } },
  evidence: { include: { evidenceCard: true } },
} satisfies Prisma.ResolutionCaseInclude;

type ResolutionCaseWithInclude = Prisma.ResolutionCaseGetPayload<{
  include: typeof resolutionInclude;
}>;

type ResolutionFinalDecision = ResolutionDecisionInput['decision'];

export class ResolutionService {
  async listCases(user: AuthenticatedUser, query: ListResolutionCasesQuery) {
    const where = await buildListWhere(user, query);
    const skip = (query.page - 1) * query.limit;
    const [items, total] = await prisma.$transaction([
      prisma.resolutionCase.findMany({
        where,
        include: resolutionInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.limit,
      }),
      prisma.resolutionCase.count({ where }),
    ]);

    return {
      items: items.map(toResolutionListItem),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async getCaseDetail(user: AuthenticatedUser, caseId: string) {
    const resolutionCase = await this.getCase(caseId);
    await this.assertCanViewCase(user, resolutionCase);

    const [relatedTask, kbMatches, auditTimeline, precheck, cascade] = await Promise.all([
      findRelatedReviewTask(resolutionCase),
      resolutionCase.evidence
        ? prisma.knowledgeBaseItem.findMany({
            where: {
              criterion: resolutionCase.evidence.criterion,
              OR: [
                {
                  evidenceName: {
                    contains: resolutionCase.evidence.evidenceName,
                    mode: 'insensitive',
                  },
                },
                {
                  eventName: {
                    contains: resolutionCase.evidence.evidenceName,
                    mode: 'insensitive',
                  },
                },
              ],
            },
            orderBy: [{ usageCount: 'desc' }, { updatedAt: 'desc' }],
            take: 3,
          })
        : [],
      prisma.auditLog.findMany({
        where: {
          OR: [
            { targetType: 'resolution_case', targetId: resolutionCase.id },
            { applicationId: resolutionCase.applicationId },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      prisma.precheckResult.findFirst({
        where: { applicationId: resolutionCase.applicationId },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.cascadeReview.findFirst({
        where: { applicationId: resolutionCase.applicationId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      resolutionCase: toResolutionListItem(resolutionCase),
      application: resolutionCase.application,
      student: resolutionCase.application.student,
      evidence: resolutionCase.evidence,
      evidenceCard: resolutionCase.evidence?.evidenceCard ?? null,
      relatedReviewTask: relatedTask,
      precheck,
      cascade,
      knowledgeBaseMatches: kbMatches,
      auditTimeline,
    };
  }

  async resolveCase(user: AuthenticatedUser, caseId: string, input: ResolutionDecisionInput) {
    const resolutionCase = await this.getCase(caseId);
    if (
      resolutionCase.status === ResolutionStatus.resolved ||
      resolutionCase.status === ResolutionStatus.rejected
    ) {
      if (user.role !== Role.admin) {
        throw new AppError(
          409,
          ErrorCodes.RESOLUTION_CASE_ALREADY_CLOSED,
          'Resolution case is already closed',
        );
      }
    }

    if (input.updateKnowledgeBase && !canManageResolution(user)) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Only staff can update knowledge base');
    }

    const relatedTask = await findRelatedReviewTask(resolutionCase);
    const closedStatus = mapCaseStatus(input.decision);
    const committeeDecision = JSON.stringify({
      decision: input.decision,
      note: input.note,
      evidenceDecisions: input.evidenceDecisions,
      workflowStatus: input.decision === 'closed_no_action' ? 'closed' : closedStatus,
      knowledgeBaseTitle: input.knowledgeBaseTitle,
      decidedAt: new Date().toISOString(),
    });

    const result = await prisma.$transaction(async (tx) => {
      await ensureResolutionOpenedAudit(tx, user, resolutionCase);

      const updatedCase = await tx.resolutionCase.update({
        where: { id: resolutionCase.id },
        data: {
          status: closedStatus,
          committeeDecision,
          closedBy: user.id,
          closedAt: new Date(),
        },
        include: resolutionInclude,
      });

      const updatedEvidenceIds = await applyEvidenceDecisions(tx, resolutionCase, input);
      const updatedTask = relatedTask
        ? await tx.reviewTask.update({
            where: { id: relatedTask.id },
            data: mapTaskUpdate(input.decision, input.note, relatedTask.status),
          })
        : null;

      const applicationStatus = await applyApplicationStatus(
        tx,
        resolutionCase.applicationId,
        input.decision,
      );

      const knowledgeBaseItem =
        input.updateKnowledgeBase && resolutionCase.evidence
          ? await tx.knowledgeBaseItem.create({
              data: {
                evidenceName:
                  input.knowledgeBaseTitle ??
                  anonymizeEvidenceName(resolutionCase.evidence.evidenceName),
                eventName: resolutionCase.evidence.eventId ? 'Verified event evidence' : null,
                criterion: resolutionCase.evidence.criterion,
                level: resolutionCase.application.targetLevel,
                decision: mapKnowledgeDecision(input.decision),
                reason: input.note,
                requiredFieldsJson: {
                  source: 'resolution',
                  resolutionCaseId: resolutionCase.id,
                } as Prisma.InputJsonValue,
                commonErrorsJson: [] as Prisma.InputJsonValue,
                createdBy: user.id,
              },
            })
          : null;

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: 'RESOLUTION_CASE_RESOLVED',
        targetType: 'resolution_case',
        targetId: resolutionCase.id,
        applicationId: resolutionCase.applicationId,
        beforeStateJson: {
          status: resolutionCase.status,
          committeeDecision: resolutionCase.committeeDecision,
        },
        afterStateJson: {
          status: closedStatus,
          decision: input.decision,
          updatedEvidenceIds,
        },
        note: input.note,
      });
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: 'RESOLUTION_DECISION_APPLIED',
        targetType: relatedTask ? 'review_task' : 'resolution_case',
        targetId: relatedTask?.id ?? resolutionCase.id,
        applicationId: resolutionCase.applicationId,
        afterStateJson: {
          decision: input.decision,
          taskStatus: updatedTask?.status,
          applicationStatus,
        },
        note: input.note,
      });
      if (knowledgeBaseItem) {
        await createApplicationAudit(tx, {
          actorId: user.id,
          actorRole: user.role,
          action: 'KNOWLEDGE_BASE_ITEM_CREATED_FROM_RESOLUTION',
          targetType: 'knowledge_base_item',
          targetId: knowledgeBaseItem.id,
          applicationId: resolutionCase.applicationId,
          afterStateJson: {
            decision: knowledgeBaseItem.decision,
            criterion: knowledgeBaseItem.criterion,
            resolutionCaseId: resolutionCase.id,
          },
          note: input.note,
        });
      }

      await notifyStudentAfterResolution(tx, resolutionCase, input, applicationStatus);
      await notifyResolutionWatchers(tx, {
        actorId: user.id,
        applicationId: resolutionCase.applicationId,
        evidenceId: resolutionCase.evidenceId,
        reviewTaskId: relatedTask?.id,
        resolutionCaseId: resolutionCase.id,
        decision: input.decision,
        status: closedStatus,
        title: 'Resolution case updated',
        message: input.note,
        assignedOfficerId: relatedTask?.assignedOfficerId,
      });

      return {
        resolutionCase: toResolutionListItem(updatedCase),
        relatedTask: updatedTask,
        application: { id: resolutionCase.applicationId, status: applicationStatus },
        knowledgeBaseItem,
      };
    });

    return result;
  }

  async updateCaseStatus(
    user: AuthenticatedUser,
    caseId: string,
    input: ResolutionStatusUpdateInput,
  ) {
    const resolutionCase = await this.getCase(caseId);
    const dbStatus = mapStatusInput(input.status);
    const isClosed = input.status === 'closed' || input.status === 'resolved' || input.status === 'rejected';
    const committeeDecision = JSON.stringify({
      ...(parseCommitteeDecision(resolutionCase.committeeDecision) ?? {}),
      workflowStatus: input.status,
      statusNote: input.note,
      statusUpdatedAt: new Date().toISOString(),
    });

    return prisma.$transaction(async (tx) => {
      await ensureResolutionOpenedAudit(tx, user, resolutionCase);
      const updated = await tx.resolutionCase.update({
        where: { id: resolutionCase.id },
        data: {
          status: dbStatus,
          committeeDecision,
          ...(isClosed ? { closedBy: user.id, closedAt: new Date() } : { closedBy: null, closedAt: null }),
        },
        include: resolutionInclude,
      });
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: 'RESOLUTION_STATUS_UPDATED',
        targetType: 'resolution_case',
        targetId: resolutionCase.id,
        applicationId: resolutionCase.applicationId,
        beforeStateJson: { status: resolutionCase.status },
        afterStateJson: { status: dbStatus, workflowStatus: input.status },
        note: input.note,
      });
      return { resolutionCase: toResolutionListItem(updated) };
    });
  }

  async reopenCase(user: AuthenticatedUser, caseId: string, input: ReopenResolutionCaseInput) {
    const resolutionCase = await this.getCase(caseId);
    if (
      resolutionCase.status === ResolutionStatus.open ||
      resolutionCase.status === ResolutionStatus.in_review
    ) {
      return resolutionCase;
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.resolutionCase.update({
        where: { id: resolutionCase.id },
        data: {
          status: ResolutionStatus.open,
          closedBy: null,
          closedAt: null,
        },
        include: resolutionInclude,
      });
      await tx.application.update({
        where: { id: resolutionCase.applicationId },
        data: { status: ApplicationStatus.resolution_needed },
      });
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.RESOLUTION_CASE_REOPENED,
        targetType: 'resolution_case',
        targetId: resolutionCase.id,
        applicationId: resolutionCase.applicationId,
        beforeStateJson: { status: resolutionCase.status, closedAt: resolutionCase.closedAt },
        afterStateJson: { status: ResolutionStatus.open },
        note: input.reason,
      });
      return { resolutionCase: toResolutionListItem(updated) };
    });
  }

  private async getCase(caseId: string) {
    const resolutionCase = await prisma.resolutionCase.findUnique({
      where: { id: caseId },
      include: resolutionInclude,
    });
    if (!resolutionCase) {
      throw new AppError(404, ErrorCodes.RESOLUTION_CASE_NOT_FOUND, 'Resolution case not found');
    }
    return resolutionCase;
  }

  private async assertCanViewCase(user: AuthenticatedUser, resolutionCase: ResolutionCaseWithInclude) {
    if (canManageResolution(user)) return;
    if (user.role !== Role.officer) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'You do not have access to this resolution case');
    }
    if (resolutionCase.createdBy === user.id) return;
    const relatedTask = await findRelatedReviewTask(resolutionCase);
    if (relatedTask?.assignedOfficerId === user.id) return;
    if (await canOfficerHandleResolutionCriterion(user.id, resolutionCase, relatedTask?.criterion)) return;
    throw new AppError(403, ErrorCodes.FORBIDDEN, 'You do not have access to this resolution case');
  }
}

async function buildListWhere(
  user: AuthenticatedUser,
  query: ListResolutionCasesQuery,
): Promise<Prisma.ResolutionCaseWhereInput> {
  const filters: Prisma.ResolutionCaseWhereInput[] = [];
  const statusFilter = statusWhere(query.status);
  if (statusFilter) filters.push(statusFilter);
  if (query.applicationId) filters.push({ applicationId: query.applicationId });
  if (query.evidenceId) filters.push({ evidenceId: query.evidenceId });
  if (query.criterion) filters.push({ evidence: { criterion: query.criterion } });
  if (query.q) {
    filters.push({
      OR: [
        { reason: { contains: query.q, mode: 'insensitive' } },
        { application: { student: { fullName: { contains: query.q, mode: 'insensitive' } } } },
        { application: { student: { studentCode: { contains: query.q, mode: 'insensitive' } } } },
        { evidence: { evidenceName: { contains: query.q, mode: 'insensitive' } } },
      ],
    });
  }
  const accessFilter = await accessWhere(user);
  if (accessFilter) filters.push(accessFilter);
  return filters.length ? { AND: filters } : {};
}

function statusWhere(status: ListResolutionCasesQuery['status']): Prisma.ResolutionCaseWhereInput | null {
  if (!status) return null;
  if (status === 'analyzing' || status === 'committee_review' || status === 'in_review') {
    return { status: ResolutionStatus.in_review };
  }
  if (status === 'closed') {
    return {
      status: ResolutionStatus.resolved,
      committeeDecision: { contains: '"decision":"closed_no_action"' },
    };
  }
  return { status: mapStatusInput(status) };
}

async function accessWhere(user: AuthenticatedUser): Promise<Prisma.ResolutionCaseWhereInput | null> {
  if (canManageResolution(user)) return null;
  if (user.role !== Role.officer) {
    return { id: '00000000-0000-0000-0000-000000000000' };
  }
  const criteria = await getOfficerCriteria(user.id);
  return {
    OR: [
      { createdBy: user.id },
      { evidence: { assignedOfficerId: user.id } },
      { application: { reviewTasks: { some: { assignedOfficerId: user.id } } } },
      ...(criteria.length ? [{ evidence: { criterion: { in: criteria } } }] : []),
    ],
  };
}

function canManageResolution(user: AuthenticatedUser) {
  return user.role === Role.manager || user.role === Role.committee || user.role === Role.admin;
}

async function getOfficerCriteria(userId: string) {
  const specs = await prisma.officerSpecialization.findMany({
    where: { officerId: userId, isActive: true },
    select: { criterion: true },
  });
  return specs.map((spec) => spec.criterion);
}

async function canOfficerHandleResolutionCriterion(
  userId: string,
  resolutionCase: ResolutionCaseWithInclude,
  fallbackCriterion?: Criterion,
) {
  const criterion = resolutionCase.evidence?.criterion ?? fallbackCriterion;
  if (!criterion) return false;
  const spec = await prisma.officerSpecialization.findFirst({
    where: { officerId: userId, criterion, isActive: true },
  });
  return !!spec;
}

async function findRelatedReviewTask(resolutionCase: {
  applicationId: string;
  evidenceId: string | null;
}) {
  if (resolutionCase.evidenceId) {
    const linked = await prisma.reviewTaskEvidence.findFirst({
      where: { evidenceId: resolutionCase.evidenceId },
      include: { reviewTask: { include: { assignedOfficer: true } } },
    });
    if (linked) return linked.reviewTask;
  }

  return prisma.reviewTask.findFirst({
    where: {
      applicationId: resolutionCase.applicationId,
      status: ReviewTaskStatus.resolution_needed,
    },
    include: { assignedOfficer: true },
  });
}

async function applyEvidenceDecisions(
  tx: Prisma.TransactionClient,
  resolutionCase: ResolutionCaseWithInclude,
  input: ResolutionDecisionInput,
) {
  const updatedEvidenceIds: string[] = [];
  if (input.decision === 'closed_no_action') return updatedEvidenceIds;

  if (input.evidenceDecisions.length > 0) {
    for (const evidenceDecision of input.evidenceDecisions) {
      await tx.evidence.update({
        where: { id: evidenceDecision.evidenceId },
        data: { status: mapEvidenceDecision(evidenceDecision.decision) },
      });
      updatedEvidenceIds.push(evidenceDecision.evidenceId);
    }
    return updatedEvidenceIds;
  }

  if (resolutionCase.evidenceId) {
    await tx.evidence.update({
      where: { id: resolutionCase.evidenceId },
      data: { status: mapEvidenceDecision(input.decision) },
    });
    updatedEvidenceIds.push(resolutionCase.evidenceId);
  }
  return updatedEvidenceIds;
}

async function applyApplicationStatus(
  tx: Prisma.TransactionClient,
  applicationId: string,
  decision: ResolutionFinalDecision,
) {
  if (decision === 'supplement_required') {
    await tx.application.update({
      where: { id: applicationId },
      data: { status: ApplicationStatus.supplement_required },
    });
    return ApplicationStatus.supplement_required;
  }

  const openCaseCount = await tx.resolutionCase.count({
    where: {
      applicationId,
      status: { in: [ResolutionStatus.open, ResolutionStatus.in_review] },
    },
  });
  if (openCaseCount > 0) {
    await tx.application.update({
      where: { id: applicationId },
      data: { status: ApplicationStatus.resolution_needed },
    });
    return ApplicationStatus.resolution_needed;
  }

  const tasks = await tx.reviewTask.findMany({ where: { applicationId } });
  const nextStatus =
    tasks.length > 0 && tasks.every((task) => task.status === ReviewTaskStatus.accepted)
      ? ApplicationStatus.completed
      : ApplicationStatus.under_review;
  await tx.application.update({
    where: { id: applicationId },
    data: { status: nextStatus },
  });
  return nextStatus;
}

async function ensureResolutionOpenedAudit(
  tx: Prisma.TransactionClient,
  user: AuthenticatedUser,
  resolutionCase: ResolutionCaseWithInclude,
) {
  const existing = await tx.auditLog.findFirst({
    where: {
      targetType: 'resolution_case',
      targetId: resolutionCase.id,
      action: 'RESOLUTION_CASE_OPENED',
    },
  });
  if (existing) return;
  await createApplicationAudit(tx, {
    actorId: user.id,
    actorRole: user.role,
    action: 'RESOLUTION_CASE_OPENED',
    targetType: 'resolution_case',
    targetId: resolutionCase.id,
    applicationId: resolutionCase.applicationId,
    afterStateJson: {
      status: resolutionCase.status,
      reason: resolutionCase.reason,
      createdBy: resolutionCase.createdBy,
    },
  });
}

async function notifyStudentAfterResolution(
  tx: Prisma.TransactionClient,
  resolutionCase: ResolutionCaseWithInclude,
  input: ResolutionDecisionInput,
  applicationStatus: ApplicationStatus,
) {
  const notificationType =
    input.decision === 'supplement_required'
      ? NotificationType.supplement_requested
      : NotificationType.resolution_updated;
  const title =
    input.decision === 'supplement_required'
      ? 'Can bo yeu cau bo sung minh chung'
      : 'Ket qua xu ly hoi dong da cap nhat';
  await createNotification(
    {
      userId: resolutionCase.application.studentId,
      applicationId: resolutionCase.applicationId,
      evidenceId: resolutionCase.evidenceId,
      resolutionCaseId: resolutionCase.id,
      type: notificationType,
      title,
      message: input.note,
      metadata: { decision: input.decision, applicationStatus },
    },
    tx,
  );
}

async function notifyResolutionWatchers(
  tx: Prisma.TransactionClient,
  input: {
    actorId: string;
    applicationId: string;
    evidenceId: string | null;
    reviewTaskId?: string | null;
    resolutionCaseId: string;
    decision: ResolutionFinalDecision;
    status: ResolutionStatus;
    title: string;
    message: string;
    assignedOfficerId?: string | null;
  },
) {
  const managers = await tx.user.findMany({
    where: { role: { in: [Role.manager, Role.admin] }, isActive: true },
    select: { id: true },
  });
  const recipients = new Set(managers.map((manager) => manager.id));

  if (input.assignedOfficerId) {
    recipients.add(input.assignedOfficerId);
  }
  recipients.delete(input.actorId);

  await Promise.all(
    Array.from(recipients).map((userId) =>
      createNotification(
        {
          userId,
          applicationId: input.applicationId,
          evidenceId: input.evidenceId,
          reviewTaskId: input.reviewTaskId,
          resolutionCaseId: input.resolutionCaseId,
          type: NotificationType.resolution_updated,
          title: input.title,
          message: input.message,
          metadata: { decision: input.decision, status: input.status },
        },
        tx,
      ),
    ),
  );
}

function mapStatusInput(status: string): ResolutionStatus {
  if (status === 'open') return ResolutionStatus.open;
  if (status === 'rejected') return ResolutionStatus.rejected;
  if (status === 'analyzing' || status === 'committee_review' || status === 'in_review') {
    return ResolutionStatus.in_review;
  }
  return ResolutionStatus.resolved;
}

function mapCaseStatus(decision: ResolutionFinalDecision): ResolutionStatus {
  if (decision === 'rejected') return ResolutionStatus.rejected;
  return ResolutionStatus.resolved;
}

function mapKnowledgeDecision(decision: ResolutionFinalDecision): KnowledgeDecision {
  if (decision === 'accepted') return KnowledgeDecision.accepted;
  if (decision === 'rejected') return KnowledgeDecision.rejected;
  if (decision === 'supplement_required') return KnowledgeDecision.needs_supplement;
  return KnowledgeDecision.reference_only;
}

function mapEvidenceDecision(decision: ResolutionFinalDecision): EvidenceStatus {
  if (decision === 'accepted') return EvidenceStatus.accepted;
  if (decision === 'rejected') return EvidenceStatus.rejected;
  if (decision === 'supplement_required') return EvidenceStatus.needs_supplement;
  return EvidenceStatus.under_review;
}

function mapTaskUpdate(
  decision: ResolutionFinalDecision,
  note: string,
  currentStatus: ReviewTaskStatus,
) {
  if (decision === 'accepted') {
    return {
      status: ReviewTaskStatus.accepted,
      decision: ReviewDecision.accepted,
      officerNote: note,
    };
  }
  if (decision === 'rejected') {
    return {
      status: ReviewTaskStatus.rejected,
      decision: ReviewDecision.rejected,
      officerNote: note,
    };
  }
  if (decision === 'supplement_required') {
    return {
      status: ReviewTaskStatus.supplement_required,
      decision: ReviewDecision.supplement_required,
      officerNote: note,
    };
  }
  return {
    status:
      currentStatus === ReviewTaskStatus.resolution_needed
        ? ReviewTaskStatus.reviewing
        : currentStatus,
    officerNote: note,
  };
}

function parseCommitteeDecision(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function anonymizeEvidenceName(name: string): string {
  return name
    .replace(/\b\d{6,}\b/g, '[MSSV]')
    .replace(/\b[A-ZĐÂÊÔƠƯÀ-Ỵ][a-zà-ỹ]+(?:\s+[A-ZĐÂÊÔƠƯÀ-Ỵ][a-zà-ỹ]+){1,4}\b/g, '[Ten sinh vien]');
}

function toResolutionListItem(item: ResolutionCaseWithInclude) {
  const parsedDecision = parseCommitteeDecision(item.committeeDecision);
  return {
    id: item.id,
    applicationId: item.applicationId,
    evidenceId: item.evidenceId,
    reason: item.reason,
    status: item.status,
    workflowStatus: parsedDecision?.workflowStatus ?? item.status,
    priority: parsedDecision?.priority ?? 'normal',
    committeeDecision: item.committeeDecision,
    application: {
      id: item.application.id,
      targetLevel: item.application.targetLevel,
      status: item.application.status,
      student: {
        fullName: item.application.student.fullName,
        studentCode: item.application.student.studentCode,
        className: item.application.student.className,
        faculty: item.application.student.faculty,
      },
    },
    evidence: item.evidence
      ? {
          id: item.evidence.id,
          evidenceName: item.evidence.evidenceName,
          criterion: item.evidence.criterion,
          confidence: item.evidence.confidence,
          status: item.evidence.status,
        }
      : null,
    createdAt: item.createdAt,
    closedAt: item.closedAt,
  };
}

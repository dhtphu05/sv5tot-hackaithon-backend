// Owns committee resolution cases and final dispute decisions.
import {
  ApplicationStatus,
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
import type {
  ListResolutionCasesQuery,
  ReopenResolutionCaseInput,
  ResolutionDecisionInput,
} from './resolution.validation';

const resolutionInclude = {
  application: { include: { student: true } },
  evidence: { include: { evidenceCard: true } },
} satisfies Prisma.ResolutionCaseInclude;

export class ResolutionService {
  async listCases(query: ListResolutionCasesQuery) {
    const where: Prisma.ResolutionCaseWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.applicationId ? { applicationId: query.applicationId } : {}),
      ...(query.evidenceId ? { evidenceId: query.evidenceId } : {}),
      ...(query.criterion ? { evidence: { criterion: query.criterion } } : {}),
      ...(query.q
        ? {
            OR: [
              { reason: { contains: query.q, mode: 'insensitive' } },
              {
                application: { student: { fullName: { contains: query.q, mode: 'insensitive' } } },
              },
              {
                application: {
                  student: { studentCode: { contains: query.q, mode: 'insensitive' } },
                },
              },
              { evidence: { evidenceName: { contains: query.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
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

  async getCaseDetail(caseId: string) {
    const resolutionCase = await this.getCase(caseId);
    const [relatedTask, kbMatches, auditTimeline] = await Promise.all([
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
    ]);

    return {
      resolutionCase,
      application: resolutionCase.application,
      student: resolutionCase.application.student,
      evidence: resolutionCase.evidence,
      evidenceCard: resolutionCase.evidence?.evidenceCard ?? null,
      relatedReviewTask: relatedTask,
      precheck: await prisma.precheckResult.findFirst({
        where: { applicationId: resolutionCase.applicationId },
        orderBy: { createdAt: 'desc' },
      }),
      cascade: await prisma.cascadeReview.findFirst({
        where: { applicationId: resolutionCase.applicationId },
        orderBy: { createdAt: 'desc' },
      }),
      knowledgeBaseMatches: kbMatches,
      auditTimeline,
    };
  }

  async decideCase(user: AuthenticatedUser, caseId: string, input: ResolutionDecisionInput) {
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

    const relatedTask = await findRelatedReviewTask(resolutionCase);
    const result = await prisma.$transaction(async (tx) => {
      const closedStatus =
        input.decision === KnowledgeDecision.rejected
          ? ResolutionStatus.rejected
          : ResolutionStatus.resolved;
      const committeeDecision = JSON.stringify({
        decision: input.decision,
        note: input.committeeNote,
        decidedAt: new Date().toISOString(),
      });

      const updatedCase = await tx.resolutionCase.update({
        where: { id: resolutionCase.id },
        data: {
          status: closedStatus,
          committeeDecision,
          closedBy: user.id,
          closedAt: new Date(),
        },
      });

      if (resolutionCase.evidenceId && input.decision !== KnowledgeDecision.reference_only) {
        await tx.evidence.update({
          where: { id: resolutionCase.evidenceId },
          data: { status: mapEvidenceStatus(input.decision) },
        });
      }

      if (input.updateRelatedTask && relatedTask) {
        await tx.reviewTask.update({
          where: { id: relatedTask.id },
          data: mapTaskUpdate(input.decision, input.committeeNote),
        });
      }

      if (input.decision === KnowledgeDecision.needs_supplement) {
        await tx.application.update({
          where: { id: resolutionCase.applicationId },
          data: { status: ApplicationStatus.supplement_required },
        });
        await tx.notification.create({
          data: {
            userId: resolutionCase.application.studentId,
            applicationId: resolutionCase.applicationId,
            type: NotificationType.supplement_required,
            title: 'Cần bổ sung minh chứng',
            message: input.committeeNote,
          },
        });
      } else {
        const openCount = await tx.resolutionCase.count({
          where: {
            applicationId: resolutionCase.applicationId,
            id: { not: resolutionCase.id },
            status: { in: [ResolutionStatus.open, ResolutionStatus.in_review] },
          },
        });
        if (
          openCount === 0 &&
          resolutionCase.application.status !== ApplicationStatus.completed &&
          resolutionCase.application.status !== ApplicationStatus.rejected
        ) {
          await tx.application.update({
            where: { id: resolutionCase.applicationId },
            data: { status: ApplicationStatus.under_review },
          });
        }
      }

      const knowledgeBaseItem =
        input.saveToKnowledgeBase && resolutionCase.evidence
          ? await tx.knowledgeBaseItem.create({
              data: {
                evidenceName: anonymizeEvidenceName(resolutionCase.evidence.evidenceName),
                eventName: resolutionCase.evidence.eventId ? 'Sự kiện đã xác minh' : null,
                criterion: resolutionCase.evidence.criterion,
                level: resolutionCase.application.targetLevel,
                decision: input.knowledgeBase?.decision ?? input.decision,
                reason: input.knowledgeBase?.reason ?? input.committeeNote,
                requiredFieldsJson: (input.knowledgeBase?.requiredFields ??
                  []) as Prisma.InputJsonValue,
                commonErrorsJson: (input.knowledgeBase?.commonErrors ??
                  []) as Prisma.InputJsonValue,
                createdBy: user.id,
              },
            })
          : null;

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.RESOLUTION_CASE_DECIDED,
        targetType: 'resolution_case',
        targetId: resolutionCase.id,
        applicationId: resolutionCase.applicationId,
        beforeStateJson: {
          status: resolutionCase.status,
          committeeDecision: resolutionCase.committeeDecision,
        },
        afterStateJson: { status: closedStatus, decision: input.decision },
        note: input.committeeNote,
      });
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: resolutionAuditAction(input.decision),
        targetType: 'resolution_case',
        targetId: resolutionCase.id,
        applicationId: resolutionCase.applicationId,
        afterStateJson: { decision: input.decision },
        note: input.committeeNote,
      });
      if (knowledgeBaseItem) {
        await createApplicationAudit(tx, {
          actorId: user.id,
          actorRole: user.role,
          action: auditActions.KNOWLEDGE_BASE_ITEM_CREATED,
          targetType: 'knowledge_base_item',
          targetId: knowledgeBaseItem.id,
          applicationId: resolutionCase.applicationId,
          afterStateJson: {
            decision: knowledgeBaseItem.decision,
            criterion: knowledgeBaseItem.criterion,
          },
        });
      }

      return { updatedCase, knowledgeBaseItem };
    });

    return result;
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
      return updated;
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

function mapEvidenceStatus(decision: KnowledgeDecision): EvidenceStatus {
  if (decision === KnowledgeDecision.accepted || decision === KnowledgeDecision.reference_only) {
    return EvidenceStatus.accepted;
  }
  if (decision === KnowledgeDecision.rejected) {
    return EvidenceStatus.rejected;
  }
  return EvidenceStatus.needs_supplement;
}

function mapTaskUpdate(decision: KnowledgeDecision, note: string) {
  if (decision === KnowledgeDecision.accepted) {
    return {
      status: ReviewTaskStatus.accepted,
      decision: ReviewDecision.accepted,
      officerNote: note,
    };
  }
  if (decision === KnowledgeDecision.rejected) {
    return {
      status: ReviewTaskStatus.rejected,
      decision: ReviewDecision.rejected,
      officerNote: note,
    };
  }
  if (decision === KnowledgeDecision.needs_supplement) {
    return {
      status: ReviewTaskStatus.supplement_required,
      decision: ReviewDecision.supplement_required,
      officerNote: note,
    };
  }
  return { officerNote: note };
}

function resolutionAuditAction(decision: KnowledgeDecision): string {
  if (decision === KnowledgeDecision.accepted || decision === KnowledgeDecision.reference_only) {
    return auditActions.RESOLUTION_CASE_ACCEPTED;
  }
  if (decision === KnowledgeDecision.rejected) return auditActions.RESOLUTION_CASE_REJECTED;
  return auditActions.RESOLUTION_CASE_NEEDS_SUPPLEMENT;
}

function anonymizeEvidenceName(name: string): string {
  return name
    .replace(/\b\d{6,}\b/g, '[MSSV]')
    .replace(/\b[A-ZĐÂÊÔƠƯÀ-Ỵ][a-zà-ỹ]+(?:\s+[A-ZĐÂÊÔƠƯÀ-Ỵ][a-zà-ỹ]+){1,4}\b/g, '[Tên sinh viên]');
}

function toResolutionListItem(
  item: Awaited<ReturnType<ResolutionService['getCaseDetail']>>['resolutionCase'],
) {
  return {
    id: item.id,
    applicationId: item.applicationId,
    evidenceId: item.evidenceId,
    reason: item.reason,
    status: item.status,
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
        }
      : null,
    createdAt: item.createdAt,
    closedAt: item.closedAt,
  };
}

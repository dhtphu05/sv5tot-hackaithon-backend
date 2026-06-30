// Owns reviewed evidence knowledge, reusable criteria references, and search.
import { prisma } from '../../infrastructure/database/prisma';
import { auditActions } from '../../shared/constants/application';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { createApplicationAudit } from '../applications/application.helpers';
import { KnowledgeBaseRepository } from './knowledge-base.repository';
import type {
  CreateFromReviewedEvidenceInput,
  KnowledgeBaseSearchQuery,
  UpdateKnowledgeBaseItemInput,
} from './knowledge-base.validation';

export class KnowledgeBaseService {
  constructor(private readonly repository = new KnowledgeBaseRepository()) {}

  async search(query: KnowledgeBaseSearchQuery) {
    const { items, total } = await this.repository.search(query);
    return {
      items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async createFromReviewedEvidence(
    user: AuthenticatedUser,
    input: CreateFromReviewedEvidenceInput,
  ) {
    const evidence = await prisma.evidence.findUnique({
      where: { id: input.evidenceId },
      include: { event: true },
    });
    if (!evidence) {
      throw new AppError(404, ErrorCodes.EVIDENCE_NOT_FOUND, 'Evidence not found');
    }
    if (!['accepted', 'rejected', 'needs_supplement'].includes(evidence.status)) {
      throw new AppError(
        409,
        ErrorCodes.KNOWLEDGE_BASE_CREATE_FAILED,
        'Evidence must be reviewed before creating a knowledge base item',
      );
    }

    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.knowledgeBaseItem.create({
        data: {
          evidenceName: input.anonymize
            ? anonymizeName(evidence.evidenceName)
            : evidence.evidenceName,
          eventName: evidence.event?.eventName ? anonymizeName(evidence.event.eventName) : null,
          criterion: evidence.criterion,
          level: input.level,
          decision: input.decision,
          reason: input.reason,
          requiredFieldsJson: input.requiredFields,
          commonErrorsJson: input.commonErrors,
          createdBy: user.id,
        },
      });
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.KNOWLEDGE_BASE_ITEM_CREATED,
        targetType: 'knowledge_base_item',
        targetId: created.id,
        applicationId: evidence.applicationId,
        afterStateJson: { criterion: created.criterion, decision: created.decision },
        note: input.reason,
      });
      return created;
    });

    return item;
  }

  async getItem(itemId: string) {
    const item = await prisma.knowledgeBaseItem.findUnique({ where: { id: itemId } });
    if (!item) {
      throw new AppError(
        404,
        ErrorCodes.KNOWLEDGE_BASE_ITEM_NOT_FOUND,
        'Knowledge base item not found',
      );
    }
    return item;
  }

  async updateItem(user: AuthenticatedUser, itemId: string, input: UpdateKnowledgeBaseItemInput) {
    const existing = await prisma.knowledgeBaseItem.findUnique({ where: { id: itemId } });
    if (!existing) {
      throw new AppError(
        404,
        ErrorCodes.KNOWLEDGE_BASE_ITEM_NOT_FOUND,
        'Knowledge base item not found',
      );
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.knowledgeBaseItem.update({
        where: { id: itemId },
        data: {
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
          ...(input.requiredFields ? { requiredFieldsJson: input.requiredFields } : {}),
          ...(input.commonErrors ? { commonErrorsJson: input.commonErrors } : {}),
          ...(input.decision ? { decision: input.decision } : {}),
          ...(input.level !== undefined ? { level: input.level } : {}),
          ...(input.evidenceName !== undefined ? { evidenceName: input.evidenceName } : {}),
          ...(input.eventName !== undefined ? { eventName: input.eventName } : {}),
        },
      });
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.KNOWLEDGE_BASE_ITEM_UPDATED,
        targetType: 'knowledge_base_item',
        targetId: itemId,
        beforeStateJson: { decision: existing.decision, level: existing.level },
        afterStateJson: { decision: updated.decision, level: updated.level },
      });
      return updated;
    });
  }

  async useItem(user: AuthenticatedUser, itemId: string) {
    const existing = await prisma.knowledgeBaseItem.findUnique({ where: { id: itemId } });
    if (!existing) {
      throw new AppError(
        404,
        ErrorCodes.KNOWLEDGE_BASE_ITEM_NOT_FOUND,
        'Knowledge base item not found',
      );
    }

    const updated = await prisma.knowledgeBaseItem.update({
      where: { id: itemId },
      data: { usageCount: { increment: 1 } },
    });
    await createApplicationAudit(prisma, {
      actorId: user.id,
      actorRole: user.role,
      action: auditActions.KNOWLEDGE_BASE_ITEM_USED,
      targetType: 'knowledge_base_item',
      targetId: itemId,
      afterStateJson: { usageCount: updated.usageCount },
    });
    return updated;
  }
}

function anonymizeName(value: string): string {
  return value.replace(/\b\d{6,}\b/g, '[MSSV]');
}

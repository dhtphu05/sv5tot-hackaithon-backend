// Owns reviewed evidence knowledge, reusable criteria references, and search.
import { Role, type Criterion } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { createApplicationAudit } from '../applications/application.helpers';
import { KnowledgeBaseRepository } from './knowledge-base.repository';
import type {
  ApprovedEvidenceNamesQuery,
  CreateFromReviewedEvidenceInput,
  KnowledgeBaseSearchQuery,
  UpdateKnowledgeBaseItemInput,
} from './knowledge-base.validation';

export class KnowledgeBaseService {
  constructor(private readonly repository = new KnowledgeBaseRepository()) {}

  async search(user: AuthenticatedUser, query: KnowledgeBaseSearchQuery) {
    const { items, total } = await this.repository.search(query);

    const isStudent = user.role === 'student' || user.role === 'class_representative';
    const processedItems = isStudent
      ? items.map((item) => this.anonymizeItem(item))
      : items;

    return {
      items: processedItems,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async searchApprovedEvidenceNames(user: AuthenticatedUser, query: ApprovedEvidenceNamesQuery) {
    const allowedCriteria =
      user.role === Role.officer ? await this.getOfficerActiveCriteria(user.id) : undefined;
    const { items, total } = await this.repository.searchApprovedEvidenceNames(
      query,
      allowedCriteria,
    );
    const isStudent = user.role === Role.student || user.role === Role.class_representative;

    return {
      items: items.map((item) => {
        const base = {
          id: item.id,
          title: item.evidenceName ?? item.eventName ?? 'Minh chứng đã duyệt',
          criterion: item.criterion,
        };

        if (isStudent) return base;

        return {
          ...base,
          eventName: item.eventName,
          level: item.level,
          usageCount: item.usageCount,
          updatedAt: item.updatedAt,
        };
      }),
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

    const title = input.title || input.reason || evidence.evidenceName || 'Minh chứng đã xét duyệt';

    let dbDecision = input.decision;
    if (dbDecision === 'resolution_needed') {
      dbDecision = 'reference_only';
    }

    const tagsString = input.tags && input.tags.length > 0
      ? `[Tags: ${input.tags.join(', ')}] `
      : '';
    const finalReason = tagsString + (input.summary || input.reason || '');
    const cleanReason = input.anonymize ? anonymizeText(finalReason) : finalReason;

    const item = await prisma.$transaction(async (tx) => {
      const metadata = {
        sourceType: evidence.sourceType,
        tags: input.tags || [],
        reusable: input.reusable ?? true,
      };

      const created = await tx.knowledgeBaseItem.create({
        data: {
          evidenceName: title,
          eventName: evidence.event?.eventName ? (input.anonymize ? anonymizeText(evidence.event.eventName) : evidence.event.eventName) : null,
          criterion: evidence.criterion,
          level: input.level || evidence.event?.organizerLevel || null,
          decision: dbDecision as any,
          reason: cleanReason,
          requiredFieldsJson: {
            requiredFields: input.requiredFields || [],
            metadata,
          } as any,
          commonErrorsJson: input.commonErrors || [],
          createdBy: user.id,
        },
      });

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: 'KNOWLEDGE_BASE_ITEM_CREATED',
        targetType: 'knowledge_base_item',
        targetId: created.id,
        applicationId: evidence.applicationId,
        afterStateJson: { criterion: created.criterion, decision: created.decision },
        note: cleanReason,
      });

      return created;
    });

    return item;
  }

  async getItem(user: AuthenticatedUser, itemId: string) {
    const item = await prisma.knowledgeBaseItem.findUnique({ where: { id: itemId } });
    if (!item) {
      throw new AppError(
        404,
        ErrorCodes.KNOWLEDGE_BASE_ITEM_NOT_FOUND,
        'Knowledge base item not found',
      );
    }
    const isStudent = user.role === 'student' || user.role === 'class_representative';
    return isStudent ? this.anonymizeItem(item) : item;
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

    let dbDecision = input.decision;
    if (dbDecision === 'resolution_needed') {
      dbDecision = 'reference_only';
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.knowledgeBaseItem.update({
        where: { id: itemId },
        data: {
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
          ...(input.requiredFields ? { requiredFieldsJson: { requiredFields: input.requiredFields } } : {}),
          ...(input.commonErrors ? { commonErrorsJson: input.commonErrors } : {}),
          ...(dbDecision ? { decision: dbDecision as any } : {}),
          ...(input.level !== undefined ? { level: input.level } : {}),
          ...(input.evidenceName !== undefined ? { evidenceName: input.evidenceName } : {}),
          ...(input.eventName !== undefined ? { eventName: input.eventName } : {}),
        },
      });

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: 'KNOWLEDGE_BASE_ITEM_UPDATED',
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
      action: 'KNOWLEDGE_BASE_ITEM_USED',
      targetType: 'knowledge_base_item',
      targetId: itemId,
      afterStateJson: { usageCount: updated.usageCount },
    });

    return updated;
  }

  private anonymizeItem(item: any) {
    return {
      ...item,
      evidenceName: item.evidenceName ? anonymizeText(item.evidenceName) : null,
      eventName: item.eventName ? anonymizeText(item.eventName) : null,
      reason: item.reason ? anonymizeText(item.reason) : null,
    };
  }

  private async getOfficerActiveCriteria(officerId: string): Promise<Criterion[]> {
    const specializations = await prisma.officerSpecialization.findMany({
      where: { officerId, isActive: true },
      select: { criterion: true },
    });

    return Array.from(new Set(specializations.map((item) => item.criterion)));
  }
}

function anonymizeText(text: string): string {
  if (!text) return text;
  // Replace studentCode (9-10 digits)
  let clean = text.replace(/\b\d{9,10}\b/g, '[STUDENT_CODE]');
  // Replace emails
  clean = clean.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]');
  // Replace phone numbers (10-11 digits)
  clean = clean.replace(/\b(0\d{9,10})\b/g, '[PHONE]');
  return clean;
}

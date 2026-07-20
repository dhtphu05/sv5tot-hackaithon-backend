// Owns reviewed evidence knowledge, reusable criteria references, and search.
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { workspaceFilterFor } from '../../shared/utils/workspace-scope';
import type { KnowledgeBaseSearchQuery } from './knowledge-base.validation';

export class KnowledgeBaseRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  async search(user: AuthenticatedUser, query: KnowledgeBaseSearchQuery) {
    let dbDecision = query.decision;
    if (dbDecision === 'resolution_needed') {
      dbDecision = 'reference_only';
    }

    const where: Prisma.KnowledgeBaseItemWhereInput = {
      ...workspaceFilterFor(user),
      ...(query.criterion ? { criterion: query.criterion } : {}),
      ...(query.level ? { level: query.level } : {}),
      ...(dbDecision ? { decision: dbDecision as any } : {}),
      ...(query.q
        ? {
            OR: [
              { evidenceName: { contains: query.q, mode: 'insensitive' } },
              { eventName: { contains: query.q, mode: 'insensitive' } },
              { reason: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    let items = await this.db.knowledgeBaseItem.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    });

    // In-memory filter for sourceType
    if (query.sourceType) {
      const targetSourceType = query.sourceType.toLowerCase();
      items = items.filter((item) => {
        const json = item.requiredFieldsJson as any;
        if (json && json.metadata && json.metadata.sourceType) {
          return json.metadata.sourceType.toLowerCase() === targetSourceType;
        }
        return false;
      });
    }

    const total = items.length;
    const skip = (query.page - 1) * query.limit;
    const paginatedItems = items.slice(skip, skip + query.limit);

    return { items: paginatedItems, total };
  }
}

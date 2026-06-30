// Owns reviewed evidence knowledge, reusable criteria references, and search.
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import type { KnowledgeBaseSearchQuery } from './knowledge-base.validation';

export class KnowledgeBaseRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  async search(query: KnowledgeBaseSearchQuery) {
    const where: Prisma.KnowledgeBaseItemWhereInput = {
      ...(query.criterion ? { criterion: query.criterion } : {}),
      ...(query.level ? { level: query.level } : {}),
      ...(query.decision ? { decision: query.decision } : {}),
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
    const skip = (query.page - 1) * query.limit;

    const [items, total] = await this.db.$transaction([
      this.db.knowledgeBaseItem.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: query.limit,
      }),
      this.db.knowledgeBaseItem.count({ where }),
    ]);

    return { items, total };
  }
}

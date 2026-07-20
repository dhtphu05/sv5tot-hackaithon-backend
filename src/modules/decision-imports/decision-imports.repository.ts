import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { workspaceFilterFor } from '../../shared/utils/workspace-scope';
import type { ListDecisionImportsQuery } from './decision-imports.validation';

export const decisionImportInclude = {
  sourceFile: true,
  documents: true,
  tables: { orderBy: [{ pageNumber: 'asc' }, { tableIndex: 'asc' }] },
  previewRows: { orderBy: [{ sourcePage: 'asc' }, { sourceTableIndex: 'asc' }, { sourceRowIndex: 'asc' }] },
} satisfies Prisma.DecisionImportInclude;

export class DecisionImportsRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  findById(id: string) {
    return this.db.decisionImport.findUnique({ where: { id }, include: decisionImportInclude });
  }

  async list(user: AuthenticatedUser, query: ListDecisionImportsQuery) {
    const where: Prisma.DecisionImportWhereInput = {
      ...workspaceFilterFor(user),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' } },
              { eventName: { contains: query.q, mode: 'insensitive' } },
              { organizer: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const skip = (query.page - 1) * query.limit;
    const [items, total] = await this.db.$transaction([
      this.db.decisionImport.findMany({
        where,
        include: {
          sourceFile: true,
          documents: true,
          _count: { select: { previewRows: true, tables: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: query.limit,
      }),
      this.db.decisionImport.count({ where }),
    ]);
    return { items, total };
  }
}

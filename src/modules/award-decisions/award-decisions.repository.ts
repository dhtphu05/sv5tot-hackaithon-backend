import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import type { ListAwardDecisionsQuery } from './award-decisions.validation';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';

export const awardDecisionInclude = {
  issuerWorkspace: { select: { id: true, code: true, name: true, shortName: true, type: true } },
  decisionFile: { select: { id: true, originalName: true, mimeType: true, fileSize: true, createdAt: true } },
  rosterFile: { select: { id: true, originalName: true, mimeType: true, fileSize: true, createdAt: true } },
  _count: { select: { recipients: true } },
} satisfies Prisma.AwardDecisionInclude;

export type AwardDecisionRecord = Prisma.AwardDecisionGetPayload<{
  include: typeof awardDecisionInclude;
}>;

export class AwardDecisionsRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  findWorkspaceById(id: string) {
    return this.db.workspace.findUnique({
      where: { id },
      select: { id: true, code: true, name: true, shortName: true, type: true, isActive: true },
    });
  }

  findById(id: string, issuerWorkspaceId?: string) {
    return this.db.awardDecision.findFirst({
      where: { id, ...(issuerWorkspaceId ? { issuerWorkspaceId } : {}) },
      include: awardDecisionInclude,
    });
  }

  async list(issuerWorkspaceId: string | undefined, query: ListAwardDecisionsQuery) {
    const where: Prisma.AwardDecisionWhereInput = {
      ...(issuerWorkspaceId ? { issuerWorkspaceId } : {}),
      ...(query.issuerWorkspaceId ? { issuerWorkspaceId: query.issuerWorkspaceId } : {}),
      ...(query.schoolYear ? { schoolYear: query.schoolYear } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { schoolYear: { contains: query.q, mode: 'insensitive' } },
              { decisionNumber: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const skip = (query.page - 1) * query.limit;
    const [items, total] = await this.db.$transaction([
      this.db.awardDecision.findMany({
        where,
        include: awardDecisionInclude,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: query.limit,
      }),
      this.db.awardDecision.count({ where }),
    ]);
    return { items, total };
  }

  create(data: Prisma.AwardDecisionUncheckedCreateInput) {
    return this.db.awardDecision.create({ data, include: awardDecisionInclude });
  }

  update(id: string, data: Prisma.AwardDecisionUpdateInput) {
    return this.db.$transaction(async (tx) => {
      const updated = await tx.awardDecision.updateMany({
        where: { id, status: 'DRAFT' },
        data,
      });
      if (updated.count !== 1) {
        const exists = await tx.awardDecision.findUnique({ where: { id }, select: { id: true } });
        if (!exists) throw new AppError(404, ErrorCodes.NOT_FOUND, 'Award decision not found');
        throw new AppError(409, ErrorCodes.CONFLICT, 'Only draft award decisions can be edited');
      }
      return tx.awardDecision.findUniqueOrThrow({ where: { id }, include: awardDecisionInclude });
    });
  }

  attachFile(input: {
    id: string;
    issuerWorkspaceId: string;
    kind: 'decision' | 'roster';
    ownerId: string;
    storageType: 'local' | 'r2';
    filePath: string;
    publicUrl: string | null;
    originalName: string;
    mimeType: string;
    fileSize: number;
  }): Promise<{ decision: AwardDecisionRecord; fileId: string }> {
    return this.db.$transaction(async (tx) => {
      const file = await tx.file.create({
        data: {
          ownerId: input.ownerId,
          uploadedBy: input.ownerId,
          workspaceId: input.issuerWorkspaceId,
          storageType: input.storageType,
          filePath: input.filePath,
          publicUrl: input.publicUrl,
          originalName: input.originalName,
          mimeType: input.mimeType,
          fileSize: input.fileSize,
        },
      });
      const decision = await tx.awardDecision.update({
        where: {
          id: input.id,
          issuerWorkspaceId: input.issuerWorkspaceId,
          status: 'DRAFT',
        },
        data:
          input.kind === 'decision'
            ? { decisionFileId: file.id }
            : { rosterFileId: file.id },
        include: awardDecisionInclude,
      });
      return { decision, fileId: file.id };
    });
  }
}

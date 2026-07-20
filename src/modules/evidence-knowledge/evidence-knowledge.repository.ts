import {
  ApprovedEvidencePrecedentStatus,
  type Criterion,
  type Level,
  type Prisma,
} from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';

export type EvidenceKnowledgeDbClient = Prisma.TransactionClient | typeof prisma;

export const approvedPrecedentSearchInclude = {
  event: { include: { aliases: true } },
} satisfies Prisma.ApprovedEvidencePrecedentInclude;

export const approvedPrecedentDetailInclude = {
  event: { include: { aliases: true } },
  sourceEvidence: {
    include: {
      event: true,
      evidenceCard: true,
      evidenceFiles: { include: { file: true } },
      application: { include: { student: true } },
    },
  },
  sourceEvidenceCard: true,
  sourceReviewTask: true,
  sourceResolutionCase: true,
  previewFile: true,
  criteriaVersion: true,
} satisfies Prisma.ApprovedEvidencePrecedentInclude;

export type ApprovedPrecedentSearchRecord = Prisma.ApprovedEvidencePrecedentGetPayload<{
  include: typeof approvedPrecedentSearchInclude;
}>;

export type ApprovedPrecedentDetailRecord = Prisma.ApprovedEvidencePrecedentGetPayload<{
  include: typeof approvedPrecedentDetailInclude;
}>;

export class EvidenceKnowledgeRepository {
  constructor(private readonly db: EvidenceKnowledgeDbClient = prisma) {}

  async searchPrecedents(input: {
    workspaceId?: string;
    criteria?: Criterion[];
    year?: number;
    level?: Level;
    limit: number;
  }): Promise<ApprovedPrecedentSearchRecord[]> {
    try {
      return await this.db.approvedEvidencePrecedent.findMany({
        where: {
          status: ApprovedEvidencePrecedentStatus.active,
          ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
          ...(input.criteria?.length ? { criterion: { in: input.criteria } } : {}),
          ...(input.year ? { eventYear: input.year } : {}),
          ...(input.level ? { applicableLevel: input.level } : {}),
        },
        include: approvedPrecedentSearchInclude,
        orderBy: { updatedAt: 'desc' },
        take: Math.max(input.limit * 20, 200),
      });
    } catch (error) {
      if (isEvidenceKnowledgeSchemaMissingError(error)) return [];
      throw error;
    }
  }

  async getEventDetail(input: {
    eventId: string;
    workspaceId?: string;
  }): Promise<ApprovedPrecedentDetailRecord[]> {
    try {
      return await this.db.approvedEvidencePrecedent.findMany({
        where: {
          eventId: input.eventId,
          status: ApprovedEvidencePrecedentStatus.active,
          ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        },
        include: approvedPrecedentDetailInclude,
        orderBy: { updatedAt: 'desc' },
      });
    } catch (error) {
      if (isEvidenceKnowledgeSchemaMissingError(error)) return [];
      throw error;
    }
  }

  async getPrecedentById(precedentId: string) {
    try {
      return await this.db.approvedEvidencePrecedent.findUnique({
        where: { id: precedentId },
        include: approvedPrecedentSearchInclude,
      });
    } catch (error) {
      if (isEvidenceKnowledgeSchemaMissingError(error)) return null;
      throw error;
    }
  }

  async findPrecedentReference(input: { eventId?: string; evidenceId?: string }) {
    try {
      return await this.db.approvedEvidencePrecedent.findFirst({
        where: {
          status: ApprovedEvidencePrecedentStatus.active,
          ...(input.eventId ? { eventId: input.eventId } : {}),
          ...(input.evidenceId ? { sourceEvidenceId: input.evidenceId } : {}),
        },
        include: approvedPrecedentSearchInclude,
      });
    } catch (error) {
      if (isEvidenceKnowledgeSchemaMissingError(error)) return null;
      throw error;
    }
  }

  async listWorkspaceAbbreviations(workspaceId?: string) {
    try {
      return await this.db.workspaceAbbreviation.findMany({
        where: {
          isActive: true,
          ...(workspaceId ? { workspaceId } : {}),
        },
      });
    } catch (error) {
      if (isEvidenceKnowledgeSchemaMissingError(error)) return [];
      throw error;
    }
  }
}

function isEvidenceKnowledgeSchemaMissingError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybeError = error as { code?: unknown; message?: unknown; meta?: unknown };
  if (maybeError.code !== 'P2021') return false;

  const detail = [
    typeof maybeError.message === 'string' ? maybeError.message : '',
    JSON.stringify(maybeError.meta ?? {}),
  ].join(' ');

  return (
    detail.includes('ApprovedEvidencePrecedent') ||
    detail.includes('WorkspaceAbbreviation') ||
    detail.includes('EventRegistryAlias')
  );
}

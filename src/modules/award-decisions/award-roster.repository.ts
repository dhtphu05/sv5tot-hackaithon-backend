import {
  AwardDecisionStatus,
  JobStatus,
  JobType,
  Role,
  WorkspaceType,
  Prisma,
  type PrismaClient,
} from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { auditActions } from '../../shared/constants/application';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { createApplicationAudit } from '../applications/application.helpers';
import {
  buildAwardRosterPreview,
  type AwardRosterMapping,
  type AwardRosterMappingContext,
  type AwardRosterSourceRow,
} from './award-roster.logic';

const awardRosterInclude = {
  issuerWorkspace: {
    select: {
      id: true,
      code: true,
      name: true,
      shortName: true,
      type: true,
      workspaceAbbreviations: {
        where: { isActive: true },
        select: { token: true, expandedText: true },
      },
    },
  },
  rosterFile: {
    select: {
      id: true,
      workspaceId: true,
      originalName: true,
      mimeType: true,
      storageType: true,
      filePath: true,
      fileSize: true,
    },
  },
} satisfies Prisma.AwardDecisionInclude;

type MappingDb = PrismaClient | Prisma.TransactionClient;

export class AwardRosterRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  findDecision(id: string, issuerWorkspaceId?: string) {
    return this.db.awardDecision.findFirst({
      where: { id, ...(issuerWorkspaceId ? { issuerWorkspaceId } : {}) },
      include: awardRosterInclude,
    });
  }

  findLatestJob(id: string, workspaceId: string) {
    return this.db.indexingJob.findFirst({
      where: { targetId: id, workspaceId, jobType: JobType.award_roster_ingestion },
      orderBy: { createdAt: 'desc' },
    });
  }

  createJob(input: { decisionId: string; workspaceId: string; rosterFileId: string; format: 'csv' | 'xlsx' | 'pdf' }) {
    return this.db.indexingJob.create({
      data: {
        targetId: input.decisionId,
        workspaceId: input.workspaceId,
        jobType: JobType.award_roster_ingestion,
        status: JobStatus.queued,
        attempts: 0,
        inputJson: { rosterFileId: input.rosterFileId, format: input.format },
      },
    });
  }

  async retryJob(id: string, decisionId: string, workspaceId: string) {
    const updated = await this.db.indexingJob.updateMany({
      where: {
        id,
        targetId: decisionId,
        workspaceId,
        jobType: JobType.award_roster_ingestion,
        status: JobStatus.failed,
      },
      data: {
        status: JobStatus.queued,
        errorMessage: null,
        resultJson: Prisma.JsonNull,
      },
    });
    return updated.count === 1 ? this.findJobById(id) : null;
  }

  findJobById(id: string) {
    return this.db.indexingJob.findUnique({ where: { id } });
  }

  async updatePreview(input: {
    jobId: string;
    decisionId: string;
    issuerWorkspaceId: string;
    rosterFileId: string;
    resultJson: Prisma.InputJsonValue;
  }) {
    await this.db.$transaction(async (tx) => {
      // A no-op status update holds the decision row lock through the mapping write.
      const decisionLock = await tx.awardDecision.updateMany({
        where: {
          id: input.decisionId,
          issuerWorkspaceId: input.issuerWorkspaceId,
          rosterFileId: input.rosterFileId,
          status: AwardDecisionStatus.DRAFT,
        },
        data: { status: AwardDecisionStatus.DRAFT },
      });
      if (decisionLock.count !== 1) {
        throw new AppError(409, ErrorCodes.CONFLICT, 'Award decision changed before mapping update');
      }

      const job = await tx.indexingJob.findFirst({
        where: {
          id: input.jobId,
          targetId: input.decisionId,
          workspaceId: input.issuerWorkspaceId,
          jobType: JobType.award_roster_ingestion,
          status: JobStatus.completed,
        },
        select: { inputJson: true },
      });
      if (asObject(job?.inputJson)?.rosterFileId !== input.rosterFileId) {
        throw new AppError(409, ErrorCodes.CONFLICT, 'Current roster file changed before mapping update');
      }

      const updated = await tx.indexingJob.updateMany({
        where: {
          id: input.jobId,
          targetId: input.decisionId,
          workspaceId: input.issuerWorkspaceId,
          jobType: JobType.award_roster_ingestion,
          status: JobStatus.completed,
        },
        data: { resultJson: input.resultJson },
      });
      if (updated.count !== 1) {
        throw new AppError(409, ErrorCodes.CONFLICT, 'Roster preview changed before mapping update');
      }
    });
  }

  async getMappingContext(
    issuerWorkspaceId: string,
    awardLevel: 'SCHOOL' | 'UNIVERSITY_SYSTEM',
    client: MappingDb = this.db,
  ): Promise<AwardRosterMappingContext> {
    const issuer = await client.workspace.findUnique({
      where: { id: issuerWorkspaceId },
      include: { workspaceAbbreviations: { where: { isActive: true }, select: { token: true, expandedText: true } } },
    });
    if (!issuer) throw new AppError(404, ErrorCodes.NOT_FOUND, 'Award issuer workspace not found');

    const schoolWorkspaces =
      awardLevel === 'UNIVERSITY_SYSTEM'
        ? await client.workspace.findMany({
            where: {
              type: WorkspaceType.SCHOOL,
              isActive: true,
              parentWorkspaceId: issuerWorkspaceId,
            },
            include: {
              workspaceAbbreviations: { where: { isActive: true }, select: { token: true, expandedText: true } },
            },
          })
        : [];
    const candidates = awardLevel === 'SCHOOL' ? [issuer] : schoolWorkspaces;
    const workspaceIds = candidates.map(({ id }) => id);
    const users = workspaceIds.length
      ? await client.user.findMany({
          where: {
            role: Role.student,
            workspaceId: { in: workspaceIds },
            studentCode: { not: null },
          },
          select: { id: true, studentCode: true, workspaceId: true },
        })
      : [];

    return {
      awardLevel,
      issuer: toInstitution(issuer),
      institutions: candidates.map(toInstitution),
      users,
    };
  }

  async confirm(input: {
    decisionId: string;
    issuerWorkspaceId?: string;
    actor: AuthenticatedUser;
  }): Promise<{ recipientCount: number }> {
    return this.db.$transaction(async (tx) => {
      const decision = await tx.awardDecision.findFirst({
        where: { id: input.decisionId, ...(input.issuerWorkspaceId ? { issuerWorkspaceId: input.issuerWorkspaceId } : {}) },
        select: {
          id: true,
          issuerWorkspaceId: true,
          awardLevel: true,
          rosterFileId: true,
          status: true,
          rosterFile: { select: { id: true, workspaceId: true } },
        },
      });
      if (!decision) throw new AppError(404, ErrorCodes.NOT_FOUND, 'Award decision not found');
      if (decision.status !== AwardDecisionStatus.DRAFT) {
        throw new AppError(409, ErrorCodes.CONFLICT, 'Only draft award decisions can be confirmed');
      }
      if (!decision.rosterFileId || decision.rosterFile?.id !== decision.rosterFileId || decision.rosterFile.workspaceId !== decision.issuerWorkspaceId) {
        throw new AppError(409, ErrorCodes.CONFLICT, 'Current roster file is missing or outside the issuer workspace');
      }

      // Serialize confirmation with remapping and roster replacement transactions.
      const decisionLock = await tx.awardDecision.updateMany({
        where: {
          id: decision.id,
          issuerWorkspaceId: decision.issuerWorkspaceId,
          rosterFileId: decision.rosterFileId,
          status: AwardDecisionStatus.DRAFT,
        },
        data: { status: AwardDecisionStatus.DRAFT },
      });
      if (decisionLock.count !== 1) {
        throw new AppError(409, ErrorCodes.CONFLICT, 'Award decision changed before confirmation');
      }

      const job = await tx.indexingJob.findFirst({
        where: {
          targetId: decision.id,
          workspaceId: decision.issuerWorkspaceId,
          jobType: JobType.award_roster_ingestion,
          status: JobStatus.completed,
        },
        orderBy: { createdAt: 'desc' },
      });
      const result = asProcessingResult(job?.resultJson);
      const inputRosterFileId = asObject(job?.inputJson)?.rosterFileId;
      if (!job || !result || inputRosterFileId !== decision.rosterFileId || result.rosterFileId !== decision.rosterFileId) {
        throw new AppError(409, ErrorCodes.CONFLICT, 'Process the current roster file before confirming');
      }

      const context = await this.getMappingContext(decision.issuerWorkspaceId, decision.awardLevel, tx);
      const preview = buildAwardRosterPreview({
        columns: result.columns,
        sourceRows: result.sourceRows,
        mapping: result.mapping,
        context,
      });
      if (preview.summary.total === 0 || preview.rows.some((row) => row.status !== 'VALID')) {
        throw new AppError(409, ErrorCodes.VALIDATION_ERROR, 'Every roster row must be valid before confirming', {
          summary: preview.summary,
        });
      }

      const confirmedAt = new Date();
      const updated = await tx.awardDecision.updateMany({
        where: {
          id: decision.id,
          issuerWorkspaceId: decision.issuerWorkspaceId,
          rosterFileId: decision.rosterFileId,
          status: AwardDecisionStatus.DRAFT,
        },
        data: {
          status: AwardDecisionStatus.CONFIRMED,
          confirmedById: input.actor.id,
          confirmedAt,
        },
      });
      if (updated.count !== 1) {
        throw new AppError(409, ErrorCodes.CONFLICT, 'Award decision was changed before confirmation');
      }

      await tx.awardRecipient.createMany({
        data: preview.rows.map((row) => ({
          awardDecisionId: decision.id,
          studentCode: row.studentCode!,
          fullName: row.fullName!,
          institutionWorkspaceId: row.institutionWorkspaceId,
          className: row.className,
          matchedUserId: row.matchedUserId,
          matchStatus: row.matchStatus,
          sourceRow: row.sourceRow,
        })),
      });
      await createApplicationAudit(tx, {
        actorId: input.actor.id,
        actorRole: input.actor.role,
        workspaceId: decision.issuerWorkspaceId,
        action: auditActions.AWARD_DECISION_CONFIRMED,
        targetType: 'award_decision',
        targetId: decision.id,
        afterStateJson: { recipientCount: preview.rows.length, awardLevel: decision.awardLevel },
      });

      return { recipientCount: preview.rows.length };
    });
  }

  async listRecipients(input: { decisionId: string; page: number; limit: number }) {
    const where = { awardDecisionId: input.decisionId };
    const [items, total] = await this.db.$transaction([
      this.db.awardRecipient.findMany({
        where,
        select: {
          id: true,
          studentCode: true,
          fullName: true,
          institutionWorkspaceId: true,
          className: true,
          matchStatus: true,
          sourceRow: true,
          createdAt: true,
          institutionWorkspace: { select: { id: true, code: true, name: true, shortName: true } },
        },
        orderBy: { sourceRow: 'asc' },
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      this.db.awardRecipient.count({ where }),
    ]);
    return { items, total };
  }
}

function toInstitution(workspace: {
  id: string;
  code: string | null;
  name: string;
  shortName: string | null;
  workspaceAbbreviations: Array<{ token: string; expandedText: string }>;
}) {
  return {
    id: workspace.id,
    code: workspace.code,
    name: workspace.name,
    shortName: workspace.shortName,
    aliases: workspace.workspaceAbbreviations.flatMap(({ token, expandedText }) => [token, expandedText]),
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asProcessingResult(value: unknown): {
  rosterFileId: string;
  columns: string[];
  sourceRows: AwardRosterSourceRow[];
  mapping: AwardRosterMapping;
} | null {
  const result = asObject(value);
  if (
    !result ||
    typeof result.rosterFileId !== 'string' ||
    !Array.isArray(result.columns) ||
    !result.columns.every((column) => typeof column === 'string') ||
    !Array.isArray(result.sourceRows) ||
    !result.sourceRows.every((row) => Array.isArray(row)) ||
    !result.mapping ||
    typeof result.mapping !== 'object'
  ) {
    return null;
  }
  return {
    rosterFileId: result.rosterFileId,
    columns: result.columns as string[],
    sourceRows: result.sourceRows as AwardRosterSourceRow[],
    mapping: result.mapping as AwardRosterMapping,
  };
}

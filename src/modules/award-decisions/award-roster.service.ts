import {
  AwardDecisionStatus,
  AwardLevel,
  JobStatus,
  Role,
  WorkspaceType,
} from '@prisma/client';
import { auditActions } from '../../shared/constants/application';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { AuditService } from '../audit/audit.service';
import { AwardRosterRepository } from './award-roster.repository';
import {
  buildAwardRosterPreview,
  getAwardRosterFormat,
  validateAwardRosterMapping,
  type AwardRosterMapping,
  type AwardRosterRowCorrection,
  type AwardRosterSourceRow,
} from './award-roster.logic';
import type {
  AwardRosterMappingInput,
  AwardRosterPageQuery,
  AwardRosterRowCorrectionInput,
} from './award-decisions.validation';

export class AwardRosterService {
  constructor(
    private readonly repository = new AwardRosterRepository(),
    private readonly auditService = new AuditService(),
  ) {}

  async processRoster(user: AuthenticatedUser, decisionId: string) {
    const decision = await this.getDecision(user, decisionId);
    this.assertDraft(decision.status);
    const rosterFile = decision.rosterFile;
    if (!rosterFile || decision.rosterFileId !== rosterFile.id || rosterFile.workspaceId !== decision.issuerWorkspaceId) {
      throw new AppError(400, ErrorCodes.EVIDENCE_FILE_REQUIRED, 'Award decision roster file is required');
    }
    let format: 'csv' | 'xlsx' | 'pdf';
    try {
      format = getAwardRosterFormat(rosterFile.originalName, rosterFile.mimeType);
    } catch (error) {
      throw new AppError(400, ErrorCodes.FILE_TYPE_NOT_ALLOWED, error instanceof Error ? error.message : 'Roster file type is not supported');
    }
    const latest = await this.repository.findLatestJob(decision.id, decision.issuerWorkspaceId);
    const currentFileJob = latest && jobRosterFileId(latest.inputJson) === rosterFile.id ? latest : null;

    if (currentFileJob?.status === JobStatus.queued || currentFileJob?.status === JobStatus.processing) {
      return { status: 'processing' as const };
    }
    if (currentFileJob?.status === JobStatus.completed) {
      return { status: 'preview_ready' as const };
    }
    if (currentFileJob?.status === JobStatus.failed) {
      const retried = await this.repository.retryJob(currentFileJob.id, decision.id, decision.issuerWorkspaceId);
      if (retried) {
        await this.logProcessingStarted(user, decision.id, decision.issuerWorkspaceId);
        return { status: 'processing' as const };
      }
    }

    await this.repository.createJob({
      decisionId: decision.id,
      workspaceId: decision.issuerWorkspaceId,
      rosterFileId: rosterFile.id,
      format,
    });
    await this.logProcessingStarted(user, decision.id, decision.issuerWorkspaceId);
    return { status: 'processing' as const };
  }

  async getProcessing(user: AuthenticatedUser, decisionId: string) {
    const decision = await this.getDecision(user, decisionId);
    if (!decision.rosterFileId) return { status: 'not_started' as const };
    const job = await this.repository.findLatestJob(decision.id, decision.issuerWorkspaceId);
    if (!job || jobRosterFileId(job.inputJson) !== decision.rosterFileId) {
      return { status: 'not_started' as const };
    }
    if (job.status === JobStatus.queued || job.status === JobStatus.processing) {
      return { status: 'processing' as const };
    }
    if (job.status === JobStatus.failed) {
      return { status: 'failed' as const, errorCode: jobErrorCode(job.resultJson), retryable: true };
    }
    return { status: 'preview_ready' as const };
  }

  async getPreview(user: AuthenticatedUser, decisionId: string, query: AwardRosterPageQuery) {
    const decision = await this.getDecision(user, decisionId);
    const result = await this.getCurrentPreview(
      decision.id,
      decision.issuerWorkspaceId,
      decision.rosterFileId,
      decision.awardLevel,
    );
    const rows = filterPreviewRows(result.rows, query.filter);
    const start = (query.page - 1) * query.limit;
    return {
      status: 'preview_ready' as const,
      columns: result.columns,
      suggestedMapping: result.suggestedMapping,
      mapping: result.mapping,
      validationSummary: result.summary,
      items: rows.slice(start, start + query.limit).map(publicPreviewRow),
      pagination: {
        page: query.page,
        limit: query.limit,
        total: rows.length,
        totalPages: Math.ceil(rows.length / query.limit),
      },
    };
  }

  async updateMapping(user: AuthenticatedUser, decisionId: string, mapping: AwardRosterMappingInput) {
    const decision = await this.getDecision(user, decisionId);
    this.assertDraft(decision.status);
    const job = await this.getCompletedCurrentJob(decision.id, decision.issuerWorkspaceId, decision.rosterFileId);
    const result = asProcessingResult(job.resultJson);
    if (!validateAwardRosterMapping(result.columns, mapping)) {
      throw new AppError(400, ErrorCodes.COLUMN_MAPPING_INVALID, 'Mapping must select existing roster columns');
    }
    const updated = await this.repository.updatePreview({
      jobId: job.id,
      decisionId: decision.id,
      issuerWorkspaceId: decision.issuerWorkspaceId,
      rosterFileId: decision.rosterFileId!,
      awardLevel: decision.awardLevel,
      change: { type: 'mapping', mapping },
    });
    return previewPage(updated, 1, 20);
  }

  async updateRow(
    user: AuthenticatedUser,
    decisionId: string,
    sourceRow: number,
    correction: AwardRosterRowCorrectionInput,
  ) {
    const decision = await this.getDecision(user, decisionId);
    this.assertDraft(decision.status);
    const job = await this.getCompletedCurrentJob(decision.id, decision.issuerWorkspaceId, decision.rosterFileId);
    const updated = await this.repository.updatePreview({
      jobId: job.id,
      decisionId: decision.id,
      issuerWorkspaceId: decision.issuerWorkspaceId,
      rosterFileId: decision.rosterFileId!,
      awardLevel: decision.awardLevel,
      change: { type: 'correct', sourceRow, correction, actor: user },
    });
    return previewPage(updated, 1, 20);
  }

  async revertRowCorrection(user: AuthenticatedUser, decisionId: string, sourceRow: number) {
    const decision = await this.getDecision(user, decisionId);
    this.assertDraft(decision.status);
    const job = await this.getCompletedCurrentJob(decision.id, decision.issuerWorkspaceId, decision.rosterFileId);
    const updated = await this.repository.updatePreview({
      jobId: job.id,
      decisionId: decision.id,
      issuerWorkspaceId: decision.issuerWorkspaceId,
      rosterFileId: decision.rosterFileId!,
      awardLevel: decision.awardLevel,
      change: { type: 'revert', sourceRow, actor: user },
    });
    return previewPage(updated, 1, 20);
  }

  async confirm(user: AuthenticatedUser, decisionId: string) {
    const decision = await this.getDecision(user, decisionId);
    this.assertDraft(decision.status);
    if (!decision.rosterFileId) throw new AppError(409, ErrorCodes.CONFLICT, 'Roster file is required before confirmation');
    return this.repository.confirm({
      decisionId: decision.id,
      issuerWorkspaceId: this.isAdmin(user) ? undefined : decision.issuerWorkspaceId,
      actor: user,
    });
  }

  async listRecipients(user: AuthenticatedUser, decisionId: string, query: AwardRosterPageQuery) {
    const decision = await this.getDecision(user, decisionId);
    if (decision.status !== AwardDecisionStatus.CONFIRMED) {
      throw new AppError(409, ErrorCodes.CONFLICT, 'Recipients are available after the decision is confirmed');
    }
    const { items, total } = await this.repository.listRecipients({ decisionId, ...query });
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

  private async getDecision(user: AuthenticatedUser, id: string) {
    const workspaceId = this.isAdmin(user) ? undefined : this.uploaderWorkspaceId(user);
    const decision = await this.repository.findDecision(id, workspaceId);
    if (!decision) throw new AppError(404, ErrorCodes.NOT_FOUND, 'Award decision not found');
    return decision;
  }

  private async getCurrentPreview(
    decisionId: string,
    workspaceId: string,
    rosterFileId: string | null,
    awardLevel: AwardLevel,
  ) {
    const job = await this.getCompletedCurrentJob(decisionId, workspaceId, rosterFileId);
    const result = asProcessingResult(job.resultJson);
    const context = await this.repository.getMappingContext(workspaceId, awardLevel);
    const preview = buildAwardRosterPreview({
      columns: result.columns,
      sourceRows: result.sourceRows,
      mapping: result.mapping,
      context,
      rowCorrections: result.rowCorrections,
    });
    return { ...result, rows: preview.rows, summary: preview.summary };
  }

  private async getCompletedCurrentJob(decisionId: string, workspaceId: string, rosterFileId: string | null) {
    if (!rosterFileId) throw new AppError(409, ErrorCodes.CONFLICT, 'Roster file is required before processing');
    const job = await this.repository.findLatestJob(decisionId, workspaceId);
    if (
      !job ||
      job.status !== JobStatus.completed ||
      jobRosterFileId(job.inputJson) !== rosterFileId ||
      jobErrorCode(job.resultJson)
    ) {
      throw new AppError(409, ErrorCodes.CONFLICT, 'Process the current roster file before continuing');
    }
    const result = asProcessingResult(job.resultJson);
    if (result.rosterFileId !== rosterFileId) {
      throw new AppError(409, ErrorCodes.CONFLICT, 'Process the current roster file before continuing');
    }
    return job;
  }

  private assertDraft(status: AwardDecisionStatus) {
    if (status !== AwardDecisionStatus.DRAFT) {
      throw new AppError(409, ErrorCodes.CONFLICT, 'Only draft award decisions can process or edit a roster');
    }
  }

  private uploaderWorkspaceId(user: AuthenticatedUser): string {
    const workspaceType = user.workspace?.type;
    if (user.role !== Role.data_uploader) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Insufficient permissions');
    }
    if (
      !user.workspaceId ||
      user.workspace?.id !== user.workspaceId ||
      (workspaceType !== WorkspaceType.SCHOOL && workspaceType !== WorkspaceType.UNIVERSITY_SYSTEM)
    ) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Data uploader workspace must be a school or university system');
    }
    return user.workspaceId;
  }

  private isAdmin(user: AuthenticatedUser) {
    return user.role === Role.admin;
  }

  private logProcessingStarted(user: AuthenticatedUser, decisionId: string, workspaceId: string) {
    return this.auditService.log({
      actorId: user.id,
      actorRole: user.role,
      workspaceId,
      action: auditActions.AWARD_ROSTER_PROCESSING_STARTED,
      entityType: 'award_decision',
      entityId: decisionId,
    });
  }
}

function jobRosterFileId(inputJson: unknown): string | null {
  if (!inputJson || typeof inputJson !== 'object' || Array.isArray(inputJson)) return null;
  const rosterFileId = (inputJson as Record<string, unknown>).rosterFileId;
  return typeof rosterFileId === 'string' ? rosterFileId : null;
}

function jobErrorCode(resultJson: unknown): string | undefined {
  if (!resultJson || typeof resultJson !== 'object' || Array.isArray(resultJson)) return undefined;
  const code = (resultJson as Record<string, unknown>).code;
  return typeof code === 'string' ? code : undefined;
}

function asProcessingResult(value: unknown): {
  rosterFileId: string;
  columns: string[];
  sourceRows: AwardRosterSourceRow[];
  suggestedMapping: AwardRosterMapping;
  mapping: AwardRosterMapping;
  rows: Array<Record<string, unknown>>;
  summary: Record<string, number>;
  rowCorrections?: Record<string, AwardRosterRowCorrection>;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(409, ErrorCodes.CONFLICT, 'Roster preview is not ready');
  }
  const result = value as Record<string, unknown>;
  if (
    typeof result.rosterFileId !== 'string' ||
    !Array.isArray(result.columns) ||
    !Array.isArray(result.sourceRows) ||
    !result.suggestedMapping ||
    !result.mapping ||
    !Array.isArray(result.rows) ||
    !result.summary
  ) {
    throw new AppError(409, ErrorCodes.CONFLICT, 'Roster preview is not ready');
  }
  return result as ReturnType<typeof asProcessingResult>;
}

function previewPage(
  result: {
    mapping: AwardRosterMapping;
    summary: Record<string, number>;
    rows: Array<Record<string, unknown>>;
  },
  page: number,
  limit: number,
) {
  const start = (page - 1) * limit;
  return {
    mapping: result.mapping,
    validationSummary: result.summary,
    items: result.rows.slice(start, start + limit).map(publicPreviewRow),
    pagination: {
      page,
      limit,
      total: result.rows.length,
      totalPages: Math.ceil(result.rows.length / limit),
    },
  };
}

function filterPreviewRows(
  rows: Array<Record<string, unknown>>,
  filter: AwardRosterPageQuery['filter'],
): Array<Record<string, unknown>> {
  switch (filter) {
    case 'attention':
      return rows.filter((row) => ['INVALID', 'DUPLICATE', 'CONFLICT'].includes(String(row.status)));
    case 'invalid':
    case 'duplicate':
    case 'conflict':
      return rows.filter((row) => row.status === filter.toUpperCase());
    case 'unmatched':
    case 'matched':
      return rows.filter((row) => row.matchStatus === filter.toUpperCase());
    case 'corrected':
      return rows.filter((row) => row.isCorrected === true);
    default:
      return rows;
  }
}

function publicPreviewRow(row: Record<string, unknown>) {
  const { matchedUserId: _matchedUserId, ...safeRow } = row;
  return safeRow;
}

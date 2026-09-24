import {
  AwardDecisionStatus,
  AwardLevel,
  FileStorageType,
  Role,
  WorkspaceType,
} from '@prisma/client';
import { env } from '../../config/env';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { auditActions } from '../../shared/constants/application';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import type {
  CreateAwardDecisionInput,
  ListAwardDecisionsQuery,
  UpdateAwardDecisionInput,
} from './award-decisions.validation';
import { AwardDecisionsRepository, type AwardDecisionRecord } from './award-decisions.repository';
import { toAwardDecisionDto } from './award-decisions.dto';

const decisionFileTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const rosterFileTypes = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
]);

export class AwardDecisionsService {
  constructor(
    private readonly repository = new AwardDecisionsRepository(),
    private readonly storageService = new StorageService(),
    private readonly auditService = new AuditService(),
  ) {}

  async list(user: AuthenticatedUser, query: ListAwardDecisionsQuery) {
    const issuerWorkspaceId = this.isAdmin(user) ? undefined : this.getUploaderScope(user).workspaceId;
    const { items, total } = await this.repository.list(issuerWorkspaceId, {
      ...query,
      issuerWorkspaceId: this.isAdmin(user) ? query.issuerWorkspaceId : undefined,
    });
    return {
      items: items.map(toAwardDecisionDto),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async create(user: AuthenticatedUser, input: CreateAwardDecisionInput) {
    const issuer = await this.resolveIssuer(user, input.issuerWorkspaceId);
    const created = await this.repository.create({
      issuerWorkspaceId: issuer.id,
      awardLevel: issuer.awardLevel,
      schoolYear: input.schoolYear,
      decisionNumber: input.decisionNumber ?? null,
      decisionDate: input.decisionDate ? new Date(input.decisionDate) : null,
      status: AwardDecisionStatus.DRAFT,
      createdById: user.id,
    });
    await this.auditService.log({
      actorId: user.id,
      actorRole: user.role,
      workspaceId: issuer.id,
      action: auditActions.AWARD_DECISION_CREATED,
      entityType: 'award_decision',
      entityId: created.id,
      after: {
        awardLevel: created.awardLevel,
        schoolYear: created.schoolYear,
        decisionNumber: created.decisionNumber,
        status: created.status,
      },
    });
    return toAwardDecisionDto(created);
  }

  async getDetail(user: AuthenticatedUser, id: string) {
    return toAwardDecisionDto(await this.getRequiredDecision(user, id));
  }

  async update(user: AuthenticatedUser, id: string, input: UpdateAwardDecisionInput) {
    const before = await this.getRequiredDecision(user, id);
    this.assertDraft(before);
    const updated = await this.repository.update(id, {
      ...(input.schoolYear !== undefined ? { schoolYear: input.schoolYear } : {}),
      ...(input.decisionNumber !== undefined ? { decisionNumber: input.decisionNumber } : {}),
      ...(input.decisionDate !== undefined
        ? { decisionDate: input.decisionDate ? new Date(input.decisionDate) : null }
        : {}),
    });
    await this.auditService.log({
      actorId: user.id,
      actorRole: user.role,
      workspaceId: before.issuerWorkspaceId,
      action: auditActions.AWARD_DECISION_UPDATED,
      entityType: 'award_decision',
      entityId: id,
      before: editableState(before),
      after: editableState(updated),
    });
    return toAwardDecisionDto(updated);
  }

  async uploadFile(
    user: AuthenticatedUser,
    id: string,
    kind: string,
    file?: Express.Multer.File,
  ) {
    const decision = await this.getRequiredDecision(user, id);
    this.assertDraft(decision);
    if (kind !== 'decision' && kind !== 'roster') {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'File kind must be decision or roster');
    }
    if (!file) {
      throw new AppError(400, ErrorCodes.EVIDENCE_FILE_REQUIRED, 'A decision or roster file is required');
    }
    const allowedTypes = kind === 'decision' ? decisionFileTypes : rosterFileTypes;
    if (!allowedTypes.has(file.mimetype)) {
      throw new AppError(400, ErrorCodes.FILE_TYPE_NOT_ALLOWED, 'File type is not allowed for this file kind');
    }

    const stored = await this.storageService.saveFile({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      directory: `award-decisions/${id}/${kind}`,
    });
    const storageType = env.STORAGE_DRIVER === 'r2' ? FileStorageType.r2 : FileStorageType.local;
    const result = await this.repository.attachFile({
      id,
      issuerWorkspaceId: decision.issuerWorkspaceId,
      kind,
      ownerId: user.id,
      storageType,
      filePath: stored.filePath,
      publicUrl: stored.publicUrl,
      originalName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
    });
    await this.auditService.log({
      actorId: user.id,
      actorRole: user.role,
      workspaceId: decision.issuerWorkspaceId,
      action: auditActions.AWARD_DECISION_FILE_UPLOADED,
      entityType: 'award_decision',
      entityId: id,
      metadata: { fileId: result.fileId, kind, mimeType: file.mimetype, size: file.size },
    });
    return toAwardDecisionDto(result.decision);
  }

  private async getRequiredDecision(user: AuthenticatedUser, id: string) {
    const issuerWorkspaceId = this.isAdmin(user) ? undefined : this.getUploaderScope(user).workspaceId;
    const decision = await this.repository.findById(id, issuerWorkspaceId);
    if (!decision) throw new AppError(404, ErrorCodes.NOT_FOUND, 'Award decision not found');
    return decision;
  }

  private async resolveIssuer(user: AuthenticatedUser, requestedWorkspaceId?: string) {
    if (!this.isAdmin(user)) {
      const scope = this.getUploaderScope(user);
      if (requestedWorkspaceId && requestedWorkspaceId !== scope.workspaceId) {
        throw new AppError(404, ErrorCodes.NOT_FOUND, 'Award decision workspace not found');
      }
      return scope;
    }
    if (!requestedWorkspaceId) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'issuerWorkspaceId is required for admin creation');
    }
    const workspace = await this.repository.findWorkspaceById(requestedWorkspaceId);
    if (!workspace) throw new AppError(404, ErrorCodes.NOT_FOUND, 'Issuer workspace not found');
    const awardLevel = awardLevelFor(workspace.type);
    if (!awardLevel) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'Issuer workspace must be a school or university system');
    }
    return { id: workspace.id, awardLevel };
  }

  private getUploaderScope(user: AuthenticatedUser) {
    if (user.role !== Role.data_uploader) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Insufficient permissions');
    }
    if (!user.workspaceId || user.workspace?.id !== user.workspaceId) {
      throw new AppError(403, ErrorCodes.USER_WORKSPACE_REQUIRED, 'User account is missing workspace configuration');
    }
    const awardLevel = user.workspace.type ? awardLevelFor(user.workspace.type) : null;
    if (!awardLevel) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Data uploader workspace must be a school or university system');
    }
    return { id: user.workspaceId, workspaceId: user.workspaceId, awardLevel };
  }

  private isAdmin(user: AuthenticatedUser) {
    return user.role === Role.admin;
  }

  private assertDraft(decision: AwardDecisionRecord) {
    if (decision.status !== AwardDecisionStatus.DRAFT) {
      throw new AppError(409, ErrorCodes.CONFLICT, 'Only draft award decisions can be edited');
    }
  }
}

function awardLevelFor(type: WorkspaceType): AwardLevel | null {
  if (type === WorkspaceType.SCHOOL) return AwardLevel.SCHOOL;
  if (type === WorkspaceType.UNIVERSITY_SYSTEM) return AwardLevel.UNIVERSITY_SYSTEM;
  return null;
}

function editableState(decision: AwardDecisionRecord) {
  return {
    schoolYear: decision.schoolYear,
    decisionNumber: decision.decisionNumber,
    decisionDate: decision.decisionDate,
  };
}

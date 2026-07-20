// Owns immutable audit log writes and privileged audit querying.
import { Prisma } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { workspaceFilterFor } from '../../shared/utils/workspace-scope';
import { redactSmartReaderSecrets } from '../smartreader/smartreader.redactor';
import type { AuditLogInput } from './audit.types';

type JsonInput = Prisma.InputJsonValue | undefined;

export class AuditService {
  async log(input: AuditLogInput) {
    const beforeJson = toJson(redactSmartReaderSecrets(input.before));
    const afterJson = toJson(redactSmartReaderSecrets(input.after));
    const metadataJson = toJson(redactSmartReaderSecrets(input.metadata));
    const client = input.tx ?? prisma;
    const workspaceId = input.workspaceId ?? (await resolveLogWorkspaceId(client, input));
    const data = {
      actorRole: input.actorRole ?? null,
      action: input.action,
      targetType: input.entityType,
      targetId: input.entityId ?? 'system',
      evidenceId: input.evidenceId ?? null,
      eventId: input.eventId ?? null,
      decisionImportId: input.decisionImportId ?? null,
      beforeStateJson: beforeJson,
      afterStateJson: afterJson,
      beforeJson,
      afterJson,
      metadataJson,
      note: input.note ?? null,
      requestId: input.requestId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      workspace: workspaceId ? { connect: { id: workspaceId } } : undefined,
      actor: input.actorId ? { connect: { id: input.actorId } } : undefined,
      application: input.applicationId ? { connect: { id: input.applicationId } } : undefined,
      collectiveProfile: input.collectiveProfileId
        ? { connect: { id: input.collectiveProfileId } }
        : undefined,
    };

    try {
      return await client.auditLog.create({ data: data as Prisma.AuditLogCreateInput });
    } catch (error) {
      if (!isPrismaCreateShapeError(error)) throw error;

      // Keep core workflows from rolling back when a running Prisma client was
      // generated from an older AuditLog shape. This preserves an audit marker
      // without blocking uploads/submits.
      return client.auditLog.create({
        data: {
          action: input.action,
          targetType: input.entityType,
          targetId: input.entityId ?? 'system',
          workspace: workspaceId ? { connect: { id: workspaceId } } : undefined,
          note: buildFallbackNote(input),
        } as Prisma.AuditLogCreateInput,
      });
    }
  }

  listLogs(params: {
    user: AuthenticatedUser;
    action?: string;
    entityType?: string;
    entityId?: string;
    requestId?: string;
    limit: number;
    offset: number;
  }) {
    return prisma.auditLog.findMany({
      where: {
        ...workspaceFilterFor(params.user),
        action: params.action,
        targetType: params.entityType,
        targetId: params.entityId,
        requestId: params.requestId,
      } as Prisma.AuditLogWhereInput,
      orderBy: { createdAt: 'desc' },
      take: params.limit,
      skip: params.offset,
    });
  }
}

async function resolveLogWorkspaceId(
  client: Prisma.TransactionClient | typeof prisma,
  input: AuditLogInput,
) {
  if (input.applicationId) {
    const application = await client.application.findUnique({
      where: { id: input.applicationId },
      select: { workspaceId: true },
    });
    if (application?.workspaceId) return application.workspaceId;
  }
  if (input.collectiveProfileId) {
    const collectiveProfile = await client.collectiveProfile.findUnique({
      where: { id: input.collectiveProfileId },
      select: { workspaceId: true },
    });
    if (collectiveProfile?.workspaceId) return collectiveProfile.workspaceId;
  }
  if (input.evidenceId) {
    const evidence = await client.evidence.findUnique({
      where: { id: input.evidenceId },
      select: {
        application: { select: { workspaceId: true } },
        collectiveProfile: { select: { workspaceId: true } },
      },
    });
    const evidenceWorkspaceId =
      evidence?.application?.workspaceId ?? evidence?.collectiveProfile?.workspaceId;
    if (evidenceWorkspaceId) return evidenceWorkspaceId;
  }
  if (input.eventId) {
    const event = await client.eventRegistry.findUnique({
      where: { id: input.eventId },
      select: { workspaceId: true },
    });
    if (event?.workspaceId) return event.workspaceId;
  }
  if (input.decisionImportId) {
    const decisionImport = await client.decisionImport.findUnique({
      where: { id: input.decisionImportId },
      select: { workspaceId: true },
    });
    if (decisionImport?.workspaceId) return decisionImport.workspaceId;
  }
  const entityId = input.entityId ?? null;
  if (!entityId || !isUuid(entityId)) return null;
  if (input.entityType === 'file') {
    const file = await client.file.findUnique({
      where: { id: entityId },
      select: { workspaceId: true },
    });
    return file?.workspaceId ?? null;
  }
  if (input.entityType === 'indexing_job' || input.entityType === 'job') {
    const job = await client.indexingJob.findUnique({
      where: { id: entityId },
      select: { workspaceId: true },
    });
    return job?.workspaceId ?? null;
  }
  return null;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function toJson(value: unknown): JsonInput {
  if (value === undefined) return undefined;
  return value as Prisma.InputJsonValue;
}

function isPrismaCreateShapeError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientValidationError &&
    String(error.message).includes('Unknown argument')
  );
}

function buildFallbackNote(input: AuditLogInput) {
  return JSON.stringify({
    actorId: input.actorId ?? null,
    actorRole: input.actorRole ?? null,
    applicationId: input.applicationId ?? null,
    collectiveProfileId: input.collectiveProfileId ?? null,
    evidenceId: input.evidenceId ?? null,
    eventId: input.eventId ?? null,
    decisionImportId: input.decisionImportId ?? null,
    requestId: input.requestId ?? null,
  });
}

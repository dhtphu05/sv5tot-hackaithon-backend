// Owns immutable audit log writes and privileged audit querying.
import { Prisma } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { redactSmartReaderSecrets } from '../smartreader/smartreader.redactor';
import type { AuditLogInput } from './audit.types';

type JsonInput = Prisma.InputJsonValue | undefined;

export class AuditService {
  async log(input: AuditLogInput) {
    const beforeJson = toJson(redactSmartReaderSecrets(input.before));
    const afterJson = toJson(redactSmartReaderSecrets(input.after));
    const metadataJson = toJson(redactSmartReaderSecrets(input.metadata));
    const client = input.tx ?? prisma;
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
      requestId: input.requestId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
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
          note: buildFallbackNote(input),
        } as Prisma.AuditLogCreateInput,
      });
    }
  }

  listLogs(params: {
    action?: string;
    entityType?: string;
    entityId?: string;
    requestId?: string;
    limit: number;
    offset: number;
  }) {
    return prisma.auditLog.findMany({
      where: {
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

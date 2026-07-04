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

    return client.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        actorRole: input.actorRole ?? null,
        action: input.action,
        targetType: input.entityType,
        targetId: input.entityId ?? 'system',
        applicationId: input.applicationId ?? null,
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
      },
    });
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
      },
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

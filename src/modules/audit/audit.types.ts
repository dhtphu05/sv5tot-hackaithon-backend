import type { Prisma, Role } from '@prisma/client';

export type AuditLogInput = {
  actorId?: string | null;
  actorRole?: Role | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  applicationId?: string | null;
  evidenceId?: string | null;
  eventId?: string | null;
  decisionImportId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  tx?: Prisma.TransactionClient;
};

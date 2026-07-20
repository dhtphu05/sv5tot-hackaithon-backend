import type { Prisma, Role } from '@prisma/client';

export type AuditLogInput = {
  actorId?: string | null;
  actorRole?: Role | null;
  workspaceId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  applicationId?: string | null;
  collectiveProfileId?: string | null;
  evidenceId?: string | null;
  eventId?: string | null;
  decisionImportId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  note?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  tx?: Prisma.TransactionClient;
};

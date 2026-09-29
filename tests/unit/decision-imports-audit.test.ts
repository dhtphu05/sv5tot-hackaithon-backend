import { Role } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findImport: vi.fn(),
  findAuditRows: vi.fn(),
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({
  prisma: {
    decisionImport: { findUnique: mocks.findImport },
    auditLog: { findMany: mocks.findAuditRows },
  },
}));

import { DecisionImportsService } from '../../src/modules/decision-imports/decision-imports.service';

const importId = '22222222-2222-4222-8222-222222222222';
const workspaceA = '11111111-1111-4111-8111-111111111111';
const workspaceB = '33333333-3333-4333-8333-333333333333';
const service = new DecisionImportsService({ findById: mocks.findImport } as never);

function user(role: Role, workspaceId: string | null = workspaceA) {
  return { id: `${role}-user`, role, workspaceId } as never;
}

describe('decision import audit workspace scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findAuditRows.mockResolvedValue([]);
  });

  it.each([Role.officer, Role.manager])('returns only same-workspace audit rows for legacy %s', async (role) => {
    mocks.findImport.mockResolvedValue({ id: importId, workspaceId: workspaceA });
    mocks.findAuditRows.mockImplementation(
      async (args: { where: { decisionImportId: string; workspaceId?: string } }) =>
        [
          { id: 'matching', decisionImportId: importId, workspaceId: workspaceA },
          { id: 'mismatched-parent', decisionImportId: importId, workspaceId: workspaceB },
          {
            id: 'mismatched-import',
            decisionImportId: '44444444-4444-4444-8444-444444444444',
            workspaceId: workspaceA,
          },
        ].filter(
          (row) =>
            row.decisionImportId === args.where.decisionImportId &&
            row.workspaceId === args.where.workspaceId,
        ),
    );

    const rows = await service.audit(user(role), importId);

    expect(rows).toEqual([
      { id: 'matching', decisionImportId: importId, workspaceId: workspaceA },
    ]);
    expect(mocks.findAuditRows).toHaveBeenCalledWith({
      where: { decisionImportId: importId, workspaceId: workspaceA },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });

  it('hides a known cross-workspace import and does not query its audit rows', async () => {
    mocks.findImport.mockResolvedValue({ id: importId, workspaceId: workspaceB });

    await expect(service.audit(user(Role.manager), importId)).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
    expect(mocks.findAuditRows).not.toHaveBeenCalled();
  });

  it('returns not found for a nonexistent import without querying audit rows', async () => {
    mocks.findImport.mockResolvedValue(null);

    await expect(service.audit(user(Role.officer), importId)).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
    expect(mocks.findAuditRows).not.toHaveBeenCalled();
  });

  it('preserves the admin global-access convention', async () => {
    mocks.findImport.mockResolvedValue({ id: importId, workspaceId: workspaceB });

    await service.audit(user(Role.admin, null), importId);

    expect(mocks.findAuditRows).toHaveBeenCalledWith({
      where: { decisionImportId: importId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });
});

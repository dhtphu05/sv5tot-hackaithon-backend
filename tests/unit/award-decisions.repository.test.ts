import { AwardDecisionStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { AwardDecisionsRepository } from '../../src/modules/award-decisions/award-decisions.repository';

function buildRepository(initialStatus: AwardDecisionStatus) {
  const state = {
    id: 'decision-1',
    issuerWorkspaceId: 'workspace-1',
    status: initialStatus,
    confirmedAt: initialStatus === AwardDecisionStatus.CONFIRMED ? new Date('2026-06-01T00:00:00.000Z') : null,
    decisionFileId: 'decision-file-1',
    rosterFileId: 'roster-file-1',
    _count: { recipients: 2 },
  };
  const updateMany = vi.fn(async ({ where, data }: { where: { status: { in?: AwardDecisionStatus[]; equals?: AwardDecisionStatus }; id: string; issuerWorkspaceId: string }; data: { status: AwardDecisionStatus } }) => {
    const matches = where.id === state.id &&
      where.issuerWorkspaceId === state.issuerWorkspaceId &&
      (where.status.in?.includes(state.status) ?? where.status.equals === state.status);
    if (!matches) return { count: 0 };
    state.status = data.status;
    return { count: 1 };
  });
  const findFirst = vi.fn(async ({ where }: { where: { id: string; issuerWorkspaceId: string } }) =>
    where.id === state.id && where.issuerWorkspaceId === state.issuerWorkspaceId ? { ...state } : null,
  );
  const tx = { awardDecision: { updateMany, findFirst } };
  const db = { $transaction: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)) };
  return { repository: new AwardDecisionsRepository(db as never), updateMany, findFirst, state };
}

describe('AwardDecisionsRepository archive transitions', () => {
  it.each([AwardDecisionStatus.DRAFT, AwardDecisionStatus.CONFIRMED])(
    'archives %s by changing only status and preserving decision relations and confirmation metadata',
    async (status) => {
      const { repository, updateMany, state } = buildRepository(status);
      const result = await repository.archive('decision-1', 'workspace-1');

      expect(result.status).toBe(AwardDecisionStatus.ARCHIVED);
      expect(result.confirmedAt).toEqual(
        status === AwardDecisionStatus.CONFIRMED ? new Date('2026-06-01T00:00:00.000Z') : null,
      );
      expect(state).toMatchObject({
        decisionFileId: 'decision-file-1',
        rosterFileId: 'roster-file-1',
        _count: { recipients: 2 },
      });
      expect(updateMany).toHaveBeenCalledWith({
        where: {
          id: 'decision-1',
          issuerWorkspaceId: 'workspace-1',
          status: { in: [AwardDecisionStatus.DRAFT, AwardDecisionStatus.CONFIRMED] },
        },
        data: { status: AwardDecisionStatus.ARCHIVED },
      });
    },
  );

  it('restores only an archived decision and leaves status conflicts without a second transition', async () => {
    const { repository, updateMany, state } = buildRepository(AwardDecisionStatus.ARCHIVED);
    const confirmedAt = new Date('2026-06-01T00:00:00.000Z');
    state.confirmedAt = confirmedAt;
    await expect(
      repository.unarchive('decision-1', 'workspace-1', AwardDecisionStatus.CONFIRMED),
    ).resolves.toMatchObject({
      status: AwardDecisionStatus.CONFIRMED,
      confirmedAt,
      decisionFileId: 'decision-file-1',
      rosterFileId: 'roster-file-1',
      _count: { recipients: 2 },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'decision-1',
        issuerWorkspaceId: 'workspace-1',
        status: { equals: AwardDecisionStatus.ARCHIVED },
      },
      data: { status: AwardDecisionStatus.CONFIRMED },
    });
  });

  it('rejects a concurrent or repeated archive with a conflict', async () => {
    const { repository } = buildRepository(AwardDecisionStatus.ARCHIVED);
    await expect(repository.archive('decision-1', 'workspace-1')).rejects.toMatchObject({ statusCode: 409 });
  });

  it.each([
    [{ page: 1, limit: 20 }, 'exclude'],
    [{ page: 1, limit: 20, archive: 'only' }, 'only'],
    [{ page: 1, limit: 20, archive: 'all' }, 'all'],
    [{ page: 1, limit: 20, status: AwardDecisionStatus.ARCHIVED, archive: 'only' }, 'only'],
    [{ page: 2, limit: 10, archive: 'only' }, 'only'],
  ] as const)('applies the %s archive filter to list queries', async (query, archive) => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const db = {
      awardDecision: { findMany, count },
      $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    };
    const repository = new AwardDecisionsRepository(db as never);

    await repository.list(undefined, query as never);

    const [findManyArgs] = findMany.mock.calls[0];
    const where = findManyArgs.where;
    expect(findManyArgs.skip).toBe((query.page - 1) * query.limit);
    expect(findManyArgs.take).toBe(query.limit);
    if (archive === 'exclude') expect(where.status).toEqual({ not: AwardDecisionStatus.ARCHIVED });
    if (archive === 'only') expect(where.status).toBe(AwardDecisionStatus.ARCHIVED);
    if (archive === 'all') expect(where).not.toHaveProperty('status');
    expect(count.mock.calls[0][0].where).toEqual(where);
  });
});

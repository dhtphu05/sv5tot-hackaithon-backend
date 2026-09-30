import { WorkspaceType, type Workspace } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { WORKSPACE_REGISTRY, seedWorkspaceRegistry } from '../../prisma/seed-workspaces';

const timestamp = new Date('2026-01-01T00:00:00.000Z');

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'existing-id',
    code: 'DHKTE-DHDN',
    type: WorkspaceType.SCHOOL,
    parentWorkspaceId: null,
    name: 'Tên cũ',
    shortName: 'DUE',
    isActive: false,
    registrationEnabled: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function createDatabase(existing: Workspace[] = [], applicationCount = 0) {
  const records = new Map(existing.map((record) => [record.code, record]));
  let nextId = 0;

  const db = {
    workspace: {
      findUnique: vi.fn(async ({ where }: { where: { code: string } }) => records.get(where.code) ?? null),
      upsert: vi.fn(
        async ({
          where,
          update,
          create,
        }: {
          where: { code: string };
          update: Partial<Workspace>;
          create: Partial<Workspace>;
        }) => {
          const current = records.get(where.code);
          const next = current
            ? { ...current, ...update }
            : workspace({ ...create, id: `created-${++nextId}` });
          records.set(where.code, next as Workspace);
          return next;
        },
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Workspace> }) => {
        const current = [...records.values()].find((record) => record.id === where.id);
        if (!current) throw new Error(`Missing fixture workspace ${where.id}`);
        const next = { ...current, ...data };
        records.set(next.code, next);
        return next;
      }),
    },
    application: {
      count: vi.fn(async ({ where }: { where: { workspaceId: string } }) =>
        where.workspaceId === 'has-history' ? 1 : applicationCount,
      ),
    },
  };

  return { db, records };
}

describe('seedWorkspaceRegistry', () => {
  it('uses stable codes on rerun without creating duplicate workspaces or changing IDs', async () => {
    const { db, records } = createDatabase();

    const firstRun = await seedWorkspaceRegistry(db as never);
    const idsAfterFirstRun = new Map([...records].map(([code, item]) => [code, item.id]));
    const secondRun = await seedWorkspaceRegistry(db as never);

    expect(records.size).toBe(WORKSPACE_REGISTRY.length);
    expect(new Set([...records.values()].map(({ id }) => id)).size).toBe(WORKSPACE_REGISTRY.length);
    expect([...records].map(([code, item]) => [code, item.id])).toEqual([...idsAfterFirstRun]);
    expect(firstRun.workspaces.size).toBe(WORKSPACE_REGISTRY.length);
    expect(secondRun.workspaces.size).toBe(WORKSPACE_REGISTRY.length);
  });

  it('updates canonical metadata by code, preserves admin status, and repairs hierarchy only without applications', async () => {
    const previous = workspace({ id: 'existing-id', code: 'DHKTE-DHDN' });
    const { db, records } = createDatabase([previous]);
    const due = WORKSPACE_REGISTRY.find(({ code }) => code === previous.code);

    await seedWorkspaceRegistry(db as never);

    const persisted = records.get(previous.code);
    expect(due).toBeDefined();
    expect(persisted).toMatchObject({
      id: previous.id,
      code: previous.code,
      name: due?.name,
      shortName: due?.shortName,
      type: WorkspaceType.SCHOOL,
      parentWorkspaceId: records.get('UDN')?.id,
      isActive: false,
      registrationEnabled: false,
    });
    expect(db.workspace.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { code: previous.code },
        update: { name: due?.name, shortName: due?.shortName },
      }),
    );
  });

  it('keeps the existing parent when historical applications use that workspace', async () => {
    const previous = workspace({ id: 'has-history', code: 'DHKTE-DHDN' });
    const { db, records } = createDatabase([previous]);

    await seedWorkspaceRegistry(db as never);

    expect(records.get(previous.code)).toMatchObject({
      id: previous.id,
      parentWorkspaceId: previous.parentWorkspaceId,
    });
    expect(db.application.count).toHaveBeenCalledWith({ where: { workspaceId: previous.id } });
    expect(db.workspace.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: previous.id } }),
    );
  });
});

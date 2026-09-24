import {
  CollectiveStatus,
  FinalStatus,
  Role,
  WorkspaceType,
} from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../src/shared/types/auth';

const prismaMock = vi.hoisted(() => ({
  collectiveProfile: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({ prisma: prismaMock }));

import { CollectiveService } from '../../src/modules/collective/collective.service';

const cityWorkspaceId = '66666666-6666-4666-8666-666666666666';
const schoolWorkspaceId = '77777777-7777-4777-8777-777777777777';

const cityManager: AuthenticatedUser = {
  id: 'city-manager',
  email: 'city-manager@5tot.test',
  fullName: 'City Manager',
  role: Role.city_manager,
  studentCode: null,
  className: null,
  faculty: null,
  avatarUrl: null,
  workspaceId: cityWorkspaceId,
  workspace: {
    id: cityWorkspaceId,
    code: 'DANANG_CITY',
    type: WorkspaceType.CITY,
    name: 'Da Nang City',
    shortName: 'Da Nang',
  },
};

const cityCommittee: AuthenticatedUser = {
  ...cityManager,
  id: 'city-committee',
  role: Role.city_committee,
};

function collectiveProfile(workspaceIsActive = true) {
  return {
    id: '88888888-8888-4888-8888-888888888888',
    workspaceId: schoolWorkspaceId,
    workspace: { type: WorkspaceType.SCHOOL, isActive: workspaceIsActive },
    representativeId: 'class-representative',
    representative: { id: 'class-representative', fullName: 'Representative' },
    status: CollectiveStatus.under_review,
    targetLevel: 'city',
    members: [],
    evidences: [],
    evidenceRecords: [],
    precheckResults: [],
    reviewTasks: [{ id: 'task-1', status: 'accepted', assignedOfficer: null }],
    finalStatus: FinalStatus.pending,
    finalLevel: null,
    finalNote: null,
    completedAt: null,
  };
}

describe('CollectiveService City workspace authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.collectiveProfile.findMany.mockResolvedValue([]);
    prismaMock.collectiveProfile.count.mockResolvedValue(0);
    prismaMock.$transaction.mockResolvedValue([[], 0]);
  });

  it('lists collective profiles from active School workspaces for City staff', async () => {
    const service = new CollectiveService({} as never, {} as never, {} as never, {} as never);

    await service.listForManager(cityManager, { page: 1, limit: 20 } as never);

    const [where] = prismaMock.collectiveProfile.findMany.mock.calls[0];
    expect(where.where).toMatchObject({
      workspace: { is: { type: WorkspaceType.SCHOOL, isActive: true } },
    });
    expect(where.where.workspaceId).toBeUndefined();
  });

  it('allows City Committee to read a School collective profile detail', async () => {
    prismaMock.collectiveProfile.findUnique.mockResolvedValue(collectiveProfile());
    const service = new CollectiveService({} as never, {} as never, {} as never, {} as never);

    const detail = await service.getDetail(cityCommittee, 'collective-1');

    expect(detail).toMatchObject({ id: collectiveProfile().id, memberSummary: { totalMembers: 0 } });
    expect(detail).not.toHaveProperty('workspace');
  });

  it('keeps representative ownership and legacy same-school staff access', async () => {
    const representative: AuthenticatedUser = {
      ...cityManager,
      id: 'class-representative',
      role: Role.class_representative,
      workspaceId: schoolWorkspaceId,
      workspace: {
        id: schoolWorkspaceId,
        code: 'DUT',
        type: WorkspaceType.SCHOOL,
        name: 'DUT',
        shortName: 'DUT',
      },
    };
    prismaMock.collectiveProfile.findUnique.mockResolvedValue(collectiveProfile());
    const service = new CollectiveService({} as never, {} as never, {} as never, {} as never);

    await expect(service.getDetail(representative, 'collective-1')).resolves.toMatchObject({
      representativeId: representative.id,
    });

    const legacyManager = { ...representative, id: 'school-manager', role: Role.manager };
    await expect(service.getDetail(legacyManager, 'collective-1')).resolves.toMatchObject({
      representativeId: representative.id,
    });
  });

  it('preserves representative ownership checks for another representative', async () => {
    const anotherRepresentative: AuthenticatedUser = {
      ...cityManager,
      id: 'different-representative',
      role: Role.class_representative,
      workspaceId: schoolWorkspaceId,
      workspace: {
        id: schoolWorkspaceId,
        code: 'DUT',
        type: WorkspaceType.SCHOOL,
        name: 'DUT',
        shortName: 'DUT',
      },
    };
    prismaMock.collectiveProfile.findUnique.mockResolvedValue(collectiveProfile());
    const service = new CollectiveService({} as never, {} as never, {} as never, {} as never);

    await expect(service.getDetail(anotherRepresentative, 'collective-1')).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('checks the City user scope before returning aggregation details', async () => {
    prismaMock.collectiveProfile.findUnique.mockResolvedValue(collectiveProfile());
    const service = new CollectiveService({} as never, {} as never, {} as never, {} as never);

    const aggregation = await service.aggregation(cityManager, 'collective-1');

    expect(aggregation.profile.id).toBe(collectiveProfile().id);
    expect(aggregation.profile).not.toHaveProperty('workspace');
  });

  it('rejects aggregation for inactive School workspaces', async () => {
    prismaMock.collectiveProfile.findUnique.mockResolvedValue(collectiveProfile(false));
    const service = new CollectiveService({} as never, {} as never, {} as never, {} as never);

    await expect(service.aggregation(cityManager, 'collective-1')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('allows only City Committee, not City Manager, to finalize active School profiles', async () => {
    prismaMock.collectiveProfile.findUnique.mockResolvedValue(collectiveProfile());
    const tx = {
      collectiveProfile: {
        findUnique: vi.fn().mockResolvedValue({ workspaceId: schoolWorkspaceId }),
        update: vi.fn().mockResolvedValue({ finalStatus: FinalStatus.passed }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    prismaMock.$transaction.mockImplementation((callback: (transaction: unknown) => unknown) =>
      callback(tx),
    );
    const service = new CollectiveService({} as never, {} as never, {} as never, {} as never);
    const input = {
      finalStatus: FinalStatus.passed,
      finalLevel: 'city',
      finalNote: 'Approved',
      notifyRepresentative: false,
      overrideAggregation: false,
    } as never;

    await expect(service.finalize(cityManager, 'collective-1', input)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();

    await expect(service.finalize(cityCommittee, 'collective-1', input)).resolves.toMatchObject({
      finalStatus: FinalStatus.passed,
    });
    expect(tx.collectiveProfile.update).toHaveBeenCalledOnce();
  });

  it('prevents City Committee from accessing inactive School profiles', async () => {
    prismaMock.collectiveProfile.findUnique.mockResolvedValue(collectiveProfile(false));
    const service = new CollectiveService({} as never, {} as never, {} as never, {} as never);

    await expect(service.getDetail(cityCommittee, 'collective-1')).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(service.finalize(cityCommittee, 'collective-1', {
      finalStatus: FinalStatus.failed,
      notifyRepresentative: false,
      overrideAggregation: true,
    } as never)).rejects.toMatchObject({ statusCode: 404 });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

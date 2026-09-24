import { Criterion, Role, WorkspaceType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../src/shared/types/auth';

const prismaMock = vi.hoisted(() => ({
  application: { findMany: vi.fn(), count: vi.fn() },
  reviewTask: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  user: { findMany: vi.fn(), findUnique: vi.fn() },
  auditLog: { create: vi.fn() },
  notification: { create: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({ prisma: prismaMock }));

import { ManagerService } from '../../src/modules/manager/manager.service';

const cityWorkspaceId = 'city-workspace';
const schoolAId = 'school-a';
const cityManager: AuthenticatedUser = {
  id: 'city-manager',
  email: 'manager@city.test',
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
    name: 'Da Nang City',
    shortName: 'Da Nang',
    type: WorkspaceType.CITY,
  },
};

describe('ManagerService City workspace scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.application.findMany.mockResolvedValue([]);
    prismaMock.application.count.mockResolvedValue(0);
    prismaMock.reviewTask.findMany.mockResolvedValue([]);
    prismaMock.user.findMany.mockResolvedValue([]);
    prismaMock.$transaction.mockResolvedValue([[], 0]);
  });

  it('lists individual applications from active School workspaces', async () => {
    const service = new ManagerService();

    await service.listApplications(cityManager, {
      page: 1,
      limit: 20,
    } as never);

    const [where] = prismaMock.application.findMany.mock.calls[0];
    expect(where.where).toMatchObject({
      workspace: { is: { type: WorkspaceType.SCHOOL, isActive: true } },
    });
    expect(where.where.workspaceId).toBeUndefined();
  });

  it('loads cross-school workload only for City Officers and active School tasks', async () => {
    const service = new ManagerService();

    await service.getWorkloads(cityManager);

    const officerQuery = prismaMock.user.findMany.mock.calls[0][0];
    expect(officerQuery.where).toMatchObject({
      workspaceId: cityWorkspaceId,
      role: Role.city_officer,
      isActive: true,
    });
    expect(officerQuery.include.assignedReviewTasks.where).toMatchObject({
      workspace: { is: { type: WorkspaceType.SCHOOL, isActive: true } },
    });
    expect(prismaMock.reviewTask.findMany.mock.calls[0][0].where).toMatchObject({
      workspace: { is: { type: WorkspaceType.SCHOOL, isActive: true } },
      assignedOfficerId: null,
    });
  });

  it('allows assignment only to an active specialized City Officer in the same City workspace', async () => {
    const task = {
      id: 'task-1',
      workspaceId: schoolAId,
      workspace: { type: WorkspaceType.SCHOOL, isActive: true },
      criterion: Criterion.academic,
      assignedOfficerId: null,
      applicationId: 'application-1',
      collectiveProfileId: null,
      application: { student: { faculty: 'Computer Science' } },
      collectiveProfile: null,
    };
    prismaMock.reviewTask.findUnique.mockResolvedValue(task);
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'city-officer-1',
      role: Role.city_officer,
      workspaceId: cityWorkspaceId,
      workspace: { type: WorkspaceType.CITY, isActive: true },
      isActive: true,
      officerSpecializations: [{ criterion: Criterion.academic, facultyScope: null }],
    });
    const tx = {
      reviewTask: { update: vi.fn().mockResolvedValue({ id: 'task-1' }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      notification: { create: vi.fn().mockResolvedValue({}) },
      application: { findUnique: vi.fn().mockResolvedValue({ workspaceId: schoolAId }) },
    };
    prismaMock.$transaction.mockImplementation((callback: (transaction: unknown) => unknown) =>
      callback(tx),
    );
    const service = new ManagerService();

    await service.reassignTask(cityManager, 'task-1', {
      assignedOfficerId: 'city-officer-1',
    } as never);

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'city-officer-1' },
      include: {
        workspace: { select: { type: true, isActive: true } },
        officerSpecializations: { where: { isActive: true } },
      },
    });
    expect(tx.reviewTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-1' },
        data: { assignedOfficerId: 'city-officer-1' },
      }),
    );
  });

  it('rejects assignment to legacy school staff from a City Manager', async () => {
    prismaMock.reviewTask.findUnique.mockResolvedValue({
      id: 'task-1',
      workspaceId: schoolAId,
      workspace: { type: WorkspaceType.SCHOOL, isActive: true },
      criterion: Criterion.academic,
      application: { student: { faculty: 'Computer Science' } },
      collectiveProfile: null,
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'school-officer',
      role: Role.officer,
      workspaceId: schoolAId,
      isActive: true,
      officerSpecializations: [{ criterion: Criterion.academic, facultyScope: null }],
    });
    const service = new ManagerService();

    await expect(
      service.reassignTask(cityManager, 'task-1', { assignedOfficerId: 'school-officer' } as never),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('allows City Manager to reassign an in-scope collective task to a City Officer', async () => {
    prismaMock.reviewTask.findUnique.mockResolvedValue({
      id: 'collective-task',
      workspaceId: schoolAId,
      workspace: { type: WorkspaceType.SCHOOL, isActive: true },
      criterion: Criterion.academic,
      applicationId: null,
      collectiveProfileId: 'collective-1',
      application: null,
      collectiveProfile: { representative: { faculty: 'Computer Science' } },
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'city-officer-1',
      role: Role.city_officer,
      workspaceId: cityWorkspaceId,
      workspace: { type: WorkspaceType.CITY, isActive: true },
      isActive: true,
      officerSpecializations: [{ criterion: Criterion.academic, facultyScope: null }],
    });
    const update = vi.fn().mockResolvedValue({ id: 'collective-task' });
    const tx = {
      reviewTask: { update },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      notification: { create: vi.fn().mockResolvedValue({}) },
      collectiveProfile: { findUnique: vi.fn().mockResolvedValue({ workspaceId: schoolAId }) },
    };
    prismaMock.$transaction.mockImplementation((callback: (transaction: unknown) => unknown) =>
      callback(tx),
    );
    const service = new ManagerService();

    await service.reassignTask(cityManager, 'collective-task', {
      assignedOfficerId: 'city-officer-1',
    } as never);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { assignedOfficerId: 'city-officer-1' } }),
    );
  });

  it('requires a matching active specialization and does not allow City Manager override', async () => {
    prismaMock.reviewTask.findUnique.mockResolvedValue({
      id: 'task-1',
      workspaceId: schoolAId,
      workspace: { type: WorkspaceType.SCHOOL, isActive: true },
      criterion: Criterion.academic,
      application: { student: { faculty: 'Computer Science' } },
      collectiveProfile: null,
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'city-officer-1',
      role: Role.city_officer,
      workspaceId: cityWorkspaceId,
      workspace: { type: WorkspaceType.CITY, isActive: true },
      isActive: true,
      officerSpecializations: [{ criterion: Criterion.physical, facultyScope: null }],
    });
    const service = new ManagerService();

    await expect(
      service.reassignTask(cityManager, 'task-1', { assignedOfficerId: 'city-officer-1' } as never),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();

    await expect(
      service.reassignTask(cityManager, 'task-1', {
        assignedOfficerId: 'city-officer-1',
        overrideSpecialization: true,
      } as never),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('keeps City Committee out of assignment and workload operations', async () => {
    const committee = { ...cityManager, role: Role.city_committee };
    const service = new ManagerService();

    await expect(service.getWorkloads(committee)).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      service.reassignTask(committee, 'task-1', { assignedOfficerId: 'officer-1' } as never),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
    expect(prismaMock.reviewTask.findUnique).not.toHaveBeenCalled();
  });
});

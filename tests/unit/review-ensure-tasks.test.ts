import { ApplicationType, Criterion, Level, Role, WorkspaceType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  application: { findUnique: vi.fn() },
  evidence: { findMany: vi.fn() },
  reviewTask: { findMany: vi.fn() },
  officerSpecialization: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));

const txMock = vi.hoisted(() => ({
  application: { findUnique: vi.fn(), update: vi.fn() },
  reviewTask: { create: vi.fn() },
  reviewTaskEvidence: { create: vi.fn() },
  auditLog: { create: vi.fn() },
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({ prisma: prismaMock }));

import { ReviewService } from '../../src/modules/review/review.service';

const officialCriteria = [
  Criterion.ethics,
  Criterion.academic,
  Criterion.physical,
  Criterion.volunteer,
  Criterion.integration,
];

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.application.findUnique.mockResolvedValue({
    id: 'application-1',
    workspaceId: 'school-1',
    applicationType: ApplicationType.individual,
    targetLevel: Level.city,
    status: 'under_review',
    student: { faculty: 'Faculty A' },
    workspace: { type: WorkspaceType.SCHOOL, isActive: true },
  });
  prismaMock.evidence.findMany.mockResolvedValue([
    { id: 'priority-evidence', criterion: Criterion.priority },
  ]);
  prismaMock.reviewTask.findMany.mockResolvedValue([]);
  prismaMock.officerSpecialization.findMany.mockResolvedValue([]);
  txMock.application.findUnique.mockResolvedValue({ workspaceId: 'school-1' });
  txMock.application.update.mockResolvedValue({});
  txMock.reviewTask.create.mockImplementation(({ data }) => ({ id: `task-${data.criterion}`, ...data }));
  txMock.reviewTaskEvidence.create.mockResolvedValue({});
  txMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });
  prismaMock.$transaction.mockImplementation(async (callback) => callback(txMock));
});

describe('ReviewService.ensureReviewTasks', () => {
  it('keeps individual City applications to the five official criteria when priority evidence exists', async () => {
    const service = new ReviewService();

    const result = await service.ensureReviewTasks(
      { id: 'admin-1', role: Role.admin } as never,
      'application-1',
      {},
    );

    const createdCriteria = txMock.reviewTask.create.mock.calls.map(
      ([input]) => input.data.criterion,
    );
    expect(createdCriteria).toEqual(officialCriteria);
    expect(createdCriteria).not.toContain(Criterion.priority);
    expect(result.ensuredCount).toBe(officialCriteria.length);
  });

  it('does not create tasks or task-creation audits when an individual City application is ensured repeatedly', async () => {
    prismaMock.reviewTask.findMany.mockResolvedValue(
      officialCriteria.map((criterion) => ({ id: `task-${criterion}`, criterion })),
    );
    const service = new ReviewService();

    const first = await service.ensureReviewTasks(
      { id: 'admin-1', role: Role.admin } as never,
      'application-1',
      {},
    );
    const second = await service.ensureReviewTasks(
      { id: 'admin-1', role: Role.admin } as never,
      'application-1',
      {},
    );

    expect(first).toEqual({ ensuredCount: 0, createdTaskIds: [] });
    expect(second).toEqual({ ensuredCount: 0, createdTaskIds: [] });
    expect(txMock.reviewTask.create).not.toHaveBeenCalled();
    expect(txMock.auditLog.create.mock.calls.map(([input]) => input.data.action)).toEqual([
      'REVIEW_TASKS_ENSURED',
      'REVIEW_TASKS_ENSURED',
    ]);
  });

  it('continues ensuring evidence criteria for legacy non-City applications', async () => {
    prismaMock.application.findUnique.mockResolvedValue({
      id: 'application-1',
      workspaceId: 'school-1',
      applicationType: ApplicationType.individual,
      targetLevel: Level.school,
      status: 'under_review',
      student: { faculty: 'Faculty A' },
      workspace: { type: WorkspaceType.SCHOOL, isActive: true },
    });

    const service = new ReviewService();

    await service.ensureReviewTasks({ id: 'admin-1', role: Role.admin } as never, 'application-1', {});

    const createdCriteria = txMock.reviewTask.create.mock.calls.map(
      ([input]) => input.data.criterion,
    );
    expect(createdCriteria).toEqual([...officialCriteria, Criterion.priority]);
  });
});

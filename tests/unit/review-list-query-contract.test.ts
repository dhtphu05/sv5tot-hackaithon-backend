import { Role, ReviewTaskStatus, WorkspaceType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  officerSpecialization: { findMany: vi.fn() },
  reviewTask: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({
  prisma: prismaMock,
}));

import { ReviewRepository, reviewTaskListInclude } from '../../src/modules/review/review.repository';
import { toTaskListItem } from '../../src/modules/review/review.service';
import { listReviewTasksQuerySchema } from '../../src/modules/review/review.validation';

const cityOfficer = {
  id: 'city-officer',
  workspaceId: 'city-workspace',
  role: Role.city_officer,
  workspace: {
    id: 'city-workspace',
    code: 'DANANG_CITY',
    type: WorkspaceType.CITY,
    isActive: true,
  },
} as never;

describe('review task list statuses contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.officerSpecialization.findMany.mockResolvedValue([
      { criterion: 'academic' },
      { criterion: 'ethics' },
    ]);
    prismaMock.reviewTask.findMany.mockResolvedValue([]);
    prismaMock.reviewTask.count.mockResolvedValue(2);
    prismaMock.$transaction.mockImplementation((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    );
  });

  it('trims and deduplicates a comma-delimited statuses query', () => {
    const parsed = listReviewTasksQuerySchema.parse({
      statuses: ' accepted, rejected, accepted ',
    });

    expect(parsed.statuses).toEqual([ReviewTaskStatus.accepted, ReviewTaskStatus.rejected]);
  });

  it('rejects invalid statuses', () => {
    const result = listReviewTasksQuerySchema.safeParse({ statuses: 'accepted,unknown' });

    expect(result.success).toBe(false);
  });

  it('rejects status and statuses together', () => {
    const result = listReviewTasksQuerySchema.safeParse({
      status: ReviewTaskStatus.waiting,
      statuses: 'accepted,rejected',
    });

    expect(result.success).toBe(false);
  });

  it('validates ownership modes without accepting arbitrary client filters', () => {
    expect(
      listReviewTasksQuerySchema.parse({ ownership: 'my_tasks' }).ownership,
    ).toBe('my_tasks');
    expect(
      listReviewTasksQuerySchema.parse({ ownership: 'visible_scope' }).ownership,
    ).toBe('visible_scope');
    expect(listReviewTasksQuerySchema.safeParse({ ownership: 'other_officer' }).success).toBe(false);
  });

  it('uses the same union predicate for findMany and count before pagination', async () => {
    const repository = new ReviewRepository();

    const result = await repository.list(cityOfficer, {
      statuses: [ReviewTaskStatus.accepted, ReviewTaskStatus.rejected],
      page: 2,
      limit: 1,
    } as never);

    expect(result.total).toBe(2);
    expect(prismaMock.reviewTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 1, take: 1 }),
    );
    const findManyWhere = prismaMock.reviewTask.findMany.mock.calls[0][0].where;
    const countWhere = prismaMock.reviewTask.count.mock.calls[0][0].where;
    expect(findManyWhere).toEqual(countWhere);
    expect(findManyWhere).toMatchObject({
      AND: expect.arrayContaining([
        expect.objectContaining({
          status: { in: [ReviewTaskStatus.accepted, ReviewTaskStatus.rejected] },
        }),
      ]),
    });
  });

  it('loads review list relations with one joined query', async () => {
    const repository = new ReviewRepository();

    await repository.list(cityOfficer, { page: 1, limit: 20 } as never);

    expect(prismaMock.reviewTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ relationLoadStrategy: 'join' }),
    );
  });

  it('limits City Officer queue specializations to active City Officers', async () => {
    const repository = new ReviewRepository();

    await repository.buildTaskWhere(cityOfficer, { page: 1, limit: 20 } as never);

    expect(prismaMock.officerSpecialization.findMany).toHaveBeenCalledWith({
      where: {
        officerId: 'city-officer',
        isActive: true,
        officer: { role: Role.city_officer, isActive: true },
      },
      select: { criterion: true },
    });
  });

  it('runs independent list and total queries concurrently without a wrapping transaction', async () => {
    const repository = new ReviewRepository();

    await repository.list(cityOfficer, { page: 1, limit: 20 } as never);

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('loads review detail relations with one joined query', async () => {
    const repository = new ReviewRepository();

    await repository.findDetail('task-1');

    expect(prismaMock.reviewTask.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ relationLoadStrategy: 'join' }),
    );
  });

  it('keeps the existing City workspace scope while applying the union', async () => {
    const repository = new ReviewRepository();

    const where = await repository.buildTaskWhere(cityOfficer, {
      statuses: [ReviewTaskStatus.accepted, ReviewTaskStatus.rejected],
    } as never);

    expect(where).toMatchObject({
      AND: expect.arrayContaining([
        { workspace: { is: { type: WorkspaceType.SCHOOL, isActive: true } } },
      ]),
    });
  });

  it('derives MY_TASKS from the authenticated actor instead of a client officer id', async () => {
    const repository = new ReviewRepository();

    const where = await repository.buildTaskWhere(cityOfficer, {
      ownership: 'my_tasks',
      assignedOfficerId: 'client-supplied-officer-id',
    } as never);

    expect(where).toMatchObject({
      AND: expect.arrayContaining([{ assignedOfficerId: 'city-officer' }]),
    });
    expect(JSON.stringify(where)).not.toContain('client-supplied-officer-id');
  });

  it('builds CLAIMABLE from canonical status, ownership and specialization predicates', async () => {
    const repository = new ReviewRepository();

    const where = await repository.buildTaskWhere(cityOfficer, {
      ownership: 'claimable',
      status: ReviewTaskStatus.reviewing,
    } as never);

    expect(where).toMatchObject({
      criterion: { in: ['academic', 'ethics'] },
      AND: expect.arrayContaining([
        { status: ReviewTaskStatus.reviewing },
        { status: ReviewTaskStatus.waiting },
        { assignedOfficerId: null },
        { decision: null },
      ]),
    });
  });

  it('applies ownership before claimable count and pagination', async () => {
    const repository = new ReviewRepository();

    const result = await repository.list(cityOfficer, {
      ownership: 'claimable',
      page: 2,
      limit: 1,
    } as never);

    expect(result.total).toBe(2);
    expect(prismaMock.reviewTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 1, take: 1 }),
    );
    const findManyWhere = prismaMock.reviewTask.findMany.mock.calls.at(-1)?.[0].where;
    const countWhere = prismaMock.reviewTask.count.mock.calls.at(-1)?.[0].where;
    expect(findManyWhere).toEqual(countWhere);
    expect(findManyWhere).toMatchObject({
      AND: expect.arrayContaining([
        { status: ReviewTaskStatus.waiting },
        { assignedOfficerId: null },
        { decision: null },
      ]),
    });
  });

  it('keeps institution identity and criterion evidence count in the list projection', () => {
    const item = toTaskListItem({
      id: 'task-1',
      criterion: 'academic',
      status: ReviewTaskStatus.waiting,
      decision: null,
      dueDate: null,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-02T00:00:00.000Z'),
      officerSuggestedLevel: null,
      workspace: {
        name: 'Trường Đại học Bách khoa - Đại học Đà Nẵng',
        shortName: 'DHBK',
      },
      application: {
        id: 'application-1',
        schoolYear: '2025-2026',
        targetLevel: 'city',
        status: 'under_review',
        student: {
          fullName: 'Student A',
          studentCode: 'S001',
          className: '22T1',
          faculty: 'Khoa CNTT',
        },
      },
      collectiveProfile: null,
      assignedOfficer: null,
      evidences: [],
      _count: { evidences: 3 },
    } as never);

    expect(item).toMatchObject({
      institutionName: 'Trường Đại học Bách khoa - Đại học Đà Nẵng',
      evidenceCount: 3,
    });
    expect(reviewTaskListInclude.workspace).toMatchObject({
      select: { name: true, shortName: true, type: true, isActive: true },
    });
    expect(reviewTaskListInclude.evidences).toMatchObject({
      include: { evidence: { select: { status: true, confidence: true } } },
    });
  });
});

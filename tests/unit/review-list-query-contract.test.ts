import { Role, ReviewTaskStatus, WorkspaceType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  officerSpecialization: { findMany: vi.fn() },
  reviewTask: { findMany: vi.fn(), count: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({
  prisma: prismaMock,
}));

import { ReviewRepository } from '../../src/modules/review/review.repository';
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
});

import { Role, WorkspaceType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { ReviewAssignmentService } from '../../src/modules/review/review-assignment.service';
import { ReviewRepository } from '../../src/modules/review/review.repository';

const cityManager = {
  id: 'city-manager',
  role: Role.city_manager,
  workspaceId: 'city-workspace',
  workspace: { id: 'city-workspace', type: WorkspaceType.CITY },
} as never;

const excludeCancelledApplicationTasks = {
  OR: [
    { applicationId: null },
    { application: { is: { cancelledAt: null } } },
  ],
};

describe('application lifecycle queue scope', () => {
  it('keeps cancelled applications out of officer and manager task lists while retaining collective tasks', async () => {
    const where = await new ReviewRepository().buildTaskWhere(cityManager, { page: 1, limit: 20 } as never);

    expect(where).toMatchObject({
      AND: expect.arrayContaining([excludeCancelledApplicationTasks]),
    });
  });

  it('excludes cancelled application tasks from assignment workload counts', async () => {
    const groupBy = vi.fn().mockResolvedValue([]);
    const service = new ReviewAssignmentService();

    await service.getOfficerWorkloads(['officer-1'], {
      reviewTask: { groupBy },
    } as never);

    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: excludeCancelledApplicationTasks.OR,
        }),
      }),
    );
  });
});

import { ReviewTaskStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { buildReviewProgress } from '../../src/modules/review/review-progress.service';

describe('buildReviewProgress', () => {
  it('allows aggregation when all tasks are terminal without resolution', () => {
    const progress = buildReviewProgress([
      ReviewTaskStatus.accepted,
      ReviewTaskStatus.rejected,
      ReviewTaskStatus.accepted,
    ]);

    expect(progress.totalTasks).toBe(3);
    expect(progress.completedTasks).toBe(3);
    expect(progress.canAggregate).toBe(true);
    expect(progress.blockingStatuses).toEqual([]);
  });

  it('blocks aggregation while supplement or resolution is pending', () => {
    const progress = buildReviewProgress([
      ReviewTaskStatus.accepted,
      ReviewTaskStatus.supplement_required,
      ReviewTaskStatus.resolution_needed,
    ]);

    expect(progress.canAggregate).toBe(false);
    expect(progress.supplementRequired).toBe(1);
    expect(progress.resolutionNeeded).toBe(1);
    expect(progress.blockingStatuses).toEqual([
      ReviewTaskStatus.supplement_required,
      ReviewTaskStatus.resolution_needed,
    ]);
  });
});

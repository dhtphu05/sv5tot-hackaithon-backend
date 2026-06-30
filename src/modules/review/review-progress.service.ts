import { ReviewTaskStatus } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';

export type ReviewProgress = {
  totalTasks: number;
  waiting: number;
  reviewing: number;
  accepted: number;
  rejected: number;
  supplementRequired: number;
  resolutionNeeded: number;
  completedTasks: number;
  canAggregate: boolean;
  blockingStatuses: string[];
};

export async function getApplicationReviewProgress(applicationId: string): Promise<ReviewProgress> {
  const tasks = await prisma.reviewTask.findMany({
    where: { applicationId },
    select: { status: true },
  });

  return buildReviewProgress(tasks.map((task) => task.status));
}

export function buildReviewProgress(statuses: ReviewTaskStatus[]): ReviewProgress {
  const count = (status: ReviewTaskStatus) => statuses.filter((item) => item === status).length;
  const waiting = count(ReviewTaskStatus.waiting);
  const reviewing = count(ReviewTaskStatus.reviewing);
  const accepted = count(ReviewTaskStatus.accepted);
  const rejected = count(ReviewTaskStatus.rejected);
  const supplementRequired = count(ReviewTaskStatus.supplement_required);
  const resolutionNeeded = count(ReviewTaskStatus.resolution_needed);
  const blockingStatuses = [
    ...(waiting > 0 ? [ReviewTaskStatus.waiting] : []),
    ...(reviewing > 0 ? [ReviewTaskStatus.reviewing] : []),
    ...(supplementRequired > 0 ? [ReviewTaskStatus.supplement_required] : []),
    ...(resolutionNeeded > 0 ? [ReviewTaskStatus.resolution_needed] : []),
  ];

  return {
    totalTasks: statuses.length,
    waiting,
    reviewing,
    accepted,
    rejected,
    supplementRequired,
    resolutionNeeded,
    completedTasks: accepted + rejected,
    canAggregate:
      statuses.length > 0 &&
      waiting === 0 &&
      reviewing === 0 &&
      supplementRequired === 0 &&
      resolutionNeeded === 0,
    blockingStatuses,
  };
}

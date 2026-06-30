import { Criterion } from '@prisma/client';
import { coreCriteria } from './criteria.constants';
import type { CriterionResult, MissingItem } from './rules.types';

const criterionWeights: Record<(typeof coreCriteria)[number], number> = {
  [Criterion.ethics]: 20,
  [Criterion.academic]: 20,
  [Criterion.physical]: 20,
  [Criterion.volunteer]: 20,
  [Criterion.integration]: 20,
};

export function scoreReadiness(criteriaResults: CriterionResult[]): {
  readinessScore: number;
  readyToSubmit: boolean;
} {
  let score = 0;
  for (const criterion of coreCriteria) {
    const result = criteriaResults.find((item) => item.criterion === criterion);
    if (!result) {
      continue;
    }
    if (result.status === 'passed') {
      score += criterionWeights[criterion];
    } else if (result.status === 'human_review_required') {
      score += criterionWeights[criterion] * 0.6;
    }
  }

  const priority = criteriaResults.find((item) => item.criterion === Criterion.priority);
  if (priority?.status === 'passed' && priority.matchedItems.length > 0) {
    score += 5;
  }

  const readinessScore = Math.min(100, Math.round(score));
  const hasDataForCoreCriteria = coreCriteria.every((criterion) => {
    const result = criteriaResults.find((item) => item.criterion === criterion);
    return Boolean(result && result.status !== 'missing');
  });
  const blockingIssueCount = criteriaResults.filter(
    (item) =>
      item.criterion !== Criterion.priority &&
      (item.status === 'missing' || item.status === 'failed'),
  ).length;

  return {
    readinessScore,
    readyToSubmit: readinessScore >= 60 && hasDataForCoreCriteria && blockingIssueCount === 0,
  };
}

export function hasSevereBlockingMissing(missingItems: MissingItem[]): boolean {
  return missingItems.some((item) => item.severity === 'blocking');
}

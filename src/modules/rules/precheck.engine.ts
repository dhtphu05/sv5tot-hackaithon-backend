import type { Level } from '@prisma/client';
import { generateNextBestAction } from './next-action.generator';
import { buildMissingItems, evaluateCriteria } from './rule-evaluator';
import { scoreReadiness } from './readiness.scorer';
import type { LevelReviewResult, RuleContext } from './rules.types';

export type PrecheckEngineResult = LevelReviewResult & {
  readyToSubmit: boolean;
  nextBestAction: string;
  humanConfirmationRequired: true;
};

export function runPrecheck(context: RuleContext & { targetLevel: Level }): PrecheckEngineResult {
  const criteriaResults = evaluateCriteria(context);
  const missingItems = buildMissingItems(criteriaResults);
  const warnings = [
    ...new Set([
      ...(context.criteriaWarnings ?? []),
      ...criteriaResults.flatMap((result) => result.warnings),
    ]),
  ];
  const readiness = scoreReadiness(criteriaResults);
  const reviewCount = criteriaResults.filter(
    (result) => result.status === 'human_review_required',
  ).length;
  const status =
    missingItems.length > 0
      ? 'missing'
      : reviewCount > 0
        ? 'human_review_required'
        : readiness.readinessScore >= 60
          ? 'likely_passed'
          : 'likely_failed';
  const nextBestAction = generateNextBestAction({
    criteriaResults,
    targetLevel: context.targetLevel,
    missingItems,
    warnings,
    readyToSubmit: readiness.readyToSubmit,
  });

  return {
    level: context.targetLevel,
    status,
    readinessScore: readiness.readinessScore,
    readyToSubmit: readiness.readyToSubmit,
    criteriaResults,
    missingItems,
    warnings,
    confidence: calculateConfidence(readiness.readinessScore, reviewCount, warnings.length),
    explanation: 'Kết quả là gợi ý tiền kiểm, không phải quyết định xét duyệt cuối cùng.',
    nextBestAction,
    humanConfirmationRequired: true,
  };
}

function calculateConfidence(
  readinessScore: number,
  reviewCount: number,
  warningCount: number,
): number {
  const base = readinessScore / 100;
  const penalty = reviewCount * 0.08 + warningCount * 0.02;
  return Math.max(0.35, Math.min(0.95, Number((base - penalty).toFixed(2))));
}

import { Level } from '@prisma/client';
import type { CollectiveMemberSummary } from './collective-member-summary';
import { calculateCollectiveReadinessScore } from './collective-readiness.scorer';

export type CollectiveEvidenceSummary = {
  total: number;
  indexed: number;
  needsReview: number;
};

export type CollectiveRuleResult = {
  code: string;
  status: 'passed' | 'missing' | 'failed' | 'human_review_required';
  passed: boolean;
  message: string;
  points: number;
  maxPoints: number;
  requiresHumanReview?: boolean;
};

export type CollectiveRulesEvaluation = {
  level: Level;
  score: number;
  maxScore: number;
  passed: boolean;
  requiresHumanReview: boolean;
  rules: CollectiveRuleResult[];
};

const requiredSchoolSv5tRateByLevel: Record<Level, number> = {
  school: 0,
  university: 20,
  city: 20,
  central: 30,
};

const requiredParticipationByLevel: Record<Level, number> = {
  school: 80,
  university: 100,
  city: 100,
  central: 100,
};

export function evaluateCollectiveRules(input: {
  level: Level;
  memberSummary: CollectiveMemberSummary;
  evidenceSummary: CollectiveEvidenceSummary;
}): CollectiveRulesEvaluation {
  const { level, memberSummary, evidenceSummary } = input;
  const participationRequired = requiredParticipationByLevel[level];
  const schoolSv5tRequired = requiredSchoolSv5tRateByLevel[level];

  const rules = [
    {
      code: 'participation_rate',
      passed:
        memberSummary.totalMembers > 0 && memberSummary.participationRate >= participationRequired,
      message: `Participation rate must be at least ${participationRequired}%`,
      points:
        memberSummary.totalMembers > 0 && memberSummary.participationRate >= participationRequired
          ? 25
          : 0,
      maxPoints: 25,
    },
    {
      code: 'school_sv5t_rate',
      passed: schoolSv5tRequired === 0 || memberSummary.schoolSv5tRate >= schoolSv5tRequired,
      message: `School SV5T rate must be at least ${schoolSv5tRequired}%`,
      points:
        schoolSv5tRequired === 0 || memberSummary.schoolSv5tRate >= schoolSv5tRequired ? 25 : 0,
      maxPoints: 25,
    },
    {
      code: 'higher_level_or_foundation',
      passed: level !== Level.central || memberSummary.higherLevelAchieverCount >= 1,
      message:
        level === Level.central
          ? 'Central level requires at least one higher-level achiever'
          : 'Foundation criteria require human review',
      points: level !== Level.central || memberSummary.higherLevelAchieverCount >= 1 ? 20 : 0,
      maxPoints: 20,
      requiresHumanReview: true,
    },
    {
      code: 'no_violation',
      passed: memberSummary.violationCount === 0,
      message: 'Collective must have no confirmed violations',
      points: memberSummary.violationCount === 0 ? 15 : 0,
      maxPoints: 15,
    },
    {
      code: 'collective_evidence',
      passed: evidenceSummary.total >= 1,
      message: 'At least one collective evidence is required',
      points: evidenceSummary.total >= 1 ? 15 : 0,
      maxPoints: 15,
    },
  ].map((rule) => ({
    ...rule,
    status: rule.requiresHumanReview
      ? rule.passed
        ? ('human_review_required' as const)
        : ('failed' as const)
      : rule.passed
        ? ('passed' as const)
        : ('missing' as const),
  })) satisfies CollectiveRuleResult[];

  const score = calculateCollectiveReadinessScore(rules);
  const requiresHumanReview = rules.some((rule) => rule.requiresHumanReview);

  return {
    level,
    score,
    maxScore: 100,
    passed: rules.every((rule) => rule.passed),
    requiresHumanReview,
    rules,
  };
}

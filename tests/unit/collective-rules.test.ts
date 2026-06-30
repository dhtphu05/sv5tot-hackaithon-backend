import { Level } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { buildCollectiveMemberSummary } from '../../src/modules/collective/collective-member-summary';
import { evaluateCollectiveRules } from '../../src/modules/collective/collective.rules';

describe('collective member summary and rules', () => {
  it('calculates roster rates and higher-level achievers', () => {
    const members = Array.from({ length: 40 }, (_, index) => ({
      participationStatus: 'participated',
      individualSv5tLevel: index === 0 ? 'city' : index < 10 ? 'school' : 'none',
      violationStatus: 'none',
    }));

    expect(buildCollectiveMemberSummary(members)).toMatchObject({
      totalMembers: 40,
      participatedMembers: 40,
      participationRate: 100,
      schoolSv5tMembers: 10,
      schoolSv5tRate: 25,
      citySv5tMembers: 1,
      higherLevelAchieverCount: 1,
      violationCount: 0,
    });
  });

  it('gives a city profile full readiness while retaining human review wording', () => {
    const evaluation = evaluateCollectiveRules({
      level: Level.city,
      memberSummary: {
        totalMembers: 40,
        participatedMembers: 40,
        notParticipatedMembers: 0,
        unknownParticipationCount: 0,
        participationRate: 100,
        schoolSv5tMembers: 10,
        schoolSv5tRate: 25,
        universitySv5tMembers: 1,
        citySv5tMembers: 1,
        centralSv5tMembers: 0,
        higherLevelAchieverCount: 1,
        violationCount: 0,
        unknownViolationCount: 0,
      },
      evidenceSummary: { total: 1, indexed: 1, needsReview: 0 },
    });

    expect(evaluation.score).toBe(100);
    expect(evaluation.passed).toBe(true);
    expect(evaluation.requiresHumanReview).toBe(true);
    expect(
      evaluation.rules.find((rule) => rule.code === 'higher_level_or_foundation')?.status,
    ).toBe('human_review_required');
  });

  it('blocks central readiness without a higher-level achiever', () => {
    const evaluation = evaluateCollectiveRules({
      level: Level.central,
      memberSummary: {
        totalMembers: 10,
        participatedMembers: 10,
        notParticipatedMembers: 0,
        unknownParticipationCount: 0,
        participationRate: 100,
        schoolSv5tMembers: 3,
        schoolSv5tRate: 30,
        universitySv5tMembers: 0,
        citySv5tMembers: 0,
        centralSv5tMembers: 0,
        higherLevelAchieverCount: 0,
        violationCount: 0,
        unknownViolationCount: 0,
      },
      evidenceSummary: { total: 1, indexed: 1, needsReview: 0 },
    });

    expect(evaluation.score).toBe(80);
    expect(evaluation.passed).toBe(false);
  });
});

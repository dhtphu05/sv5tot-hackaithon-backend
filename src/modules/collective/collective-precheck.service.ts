import type { CollectiveMember, Evidence, Level } from '@prisma/client';
import { buildCollectiveMemberSummary } from './collective-member-summary';
import { buildCollectiveNextActions } from './collective-next-action.generator';
import { evaluateCollectiveRules } from './collective.rules';

export function runCollectivePrecheck(input: {
  level: Level;
  members: Array<
    Pick<CollectiveMember, 'participationStatus' | 'individualSv5tLevel' | 'violationStatus'>
  >;
  evidences: Array<Pick<Evidence, 'indexingStatus'>>;
}) {
  const memberSummary = buildCollectiveMemberSummary(input.members);
  const evidenceSummary = {
    total: input.evidences.length,
    indexed: input.evidences.filter((item) => item.indexingStatus === 'indexed').length,
    needsReview: input.evidences.filter((item) => item.indexingStatus === 'needs_manual_review')
      .length,
  };
  const evaluation = evaluateCollectiveRules({
    level: input.level,
    memberSummary,
    evidenceSummary,
  });

  return {
    memberSummary,
    evidenceSummary,
    evaluation,
    nextActions: buildCollectiveNextActions(evaluation),
  };
}

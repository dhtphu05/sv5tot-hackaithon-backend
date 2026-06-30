import type { CollectiveMember } from '@prisma/client';

const higherLevels = new Set(['university', 'city', 'central']);

export type CollectiveMemberSummary = {
  totalMembers: number;
  participatedMembers: number;
  notParticipatedMembers: number;
  unknownParticipationCount: number;
  participationRate: number;
  schoolSv5tMembers: number;
  schoolSv5tRate: number;
  universitySv5tMembers: number;
  citySv5tMembers: number;
  centralSv5tMembers: number;
  higherLevelAchieverCount: number;
  violationCount: number;
  unknownViolationCount: number;
};

export function buildCollectiveMemberSummary(
  members: Array<
    Pick<CollectiveMember, 'participationStatus' | 'individualSv5tLevel' | 'violationStatus'>
  >,
): CollectiveMemberSummary {
  const totalMembers = members.length;
  const participatedMembers = members.filter(
    (item) => item.participationStatus === 'participated',
  ).length;
  const notParticipatedMembers = members.filter(
    (item) => item.participationStatus === 'not_participated',
  ).length;
  const unknownParticipationCount = members.filter(
    (item) => !item.participationStatus || item.participationStatus === 'unknown',
  ).length;
  const schoolSv5tMembers = members.filter((item) =>
    ['school', 'university', 'city', 'central'].includes(item.individualSv5tLevel ?? ''),
  ).length;
  const universitySv5tMembers = members.filter((item) =>
    ['university', 'city', 'central'].includes(item.individualSv5tLevel ?? ''),
  ).length;
  const citySv5tMembers = members.filter((item) =>
    ['city', 'central'].includes(item.individualSv5tLevel ?? ''),
  ).length;
  const centralSv5tMembers = members.filter(
    (item) => item.individualSv5tLevel === 'central',
  ).length;
  const higherLevelAchieverCount = members.filter((item) =>
    higherLevels.has(item.individualSv5tLevel ?? ''),
  ).length;
  const violationCount = members.filter((item) => item.violationStatus === 'violated').length;
  const unknownViolationCount = members.filter(
    (item) => !item.violationStatus || item.violationStatus === 'unknown',
  ).length;

  return {
    totalMembers,
    participatedMembers,
    notParticipatedMembers,
    unknownParticipationCount,
    participationRate:
      totalMembers > 0 ? Math.round((participatedMembers / totalMembers) * 100) : 0,
    schoolSv5tMembers,
    schoolSv5tRate: totalMembers > 0 ? Math.round((schoolSv5tMembers / totalMembers) * 100) : 0,
    universitySv5tMembers,
    citySv5tMembers,
    centralSv5tMembers,
    higherLevelAchieverCount,
    violationCount,
    unknownViolationCount,
  };
}

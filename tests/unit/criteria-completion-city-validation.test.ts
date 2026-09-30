import { describe, expect, it } from 'vitest';
import {
  addAcademicAchievementSchema,
  addEthicsAchievementSchema,
  addIntegrationPathResponseSchema,
  addPhysicalPathEvidenceSchema,
  addVolunteerPathEvidenceSchema,
} from '../../src/modules/criteria-completion/criteria-completion.validation';

const evidenceId = 'b4aa3bdc-9c64-43e7-a2dd-236733eb8578';

describe('City criteria input validation', () => {
  it('accepts City criterion keys through the existing scoped evidence endpoints', () => {
    expect(
      addEthicsAchievementSchema.safeParse({
        evidenceId,
        achievementType: 'ideology_article_or_presentation',
      }).success,
    ).toBe(true);
    expect(
      addAcademicAchievementSchema.safeParse({
        evidenceId,
        achievementType: 'student_research_faculty',
      }).success,
    ).toBe(true);
    expect(
      addPhysicalPathEvidenceSchema.safeParse({
        evidenceId,
        requirementKey: 'sports_activity_or_award',
      }).success,
    ).toBe(true);
    expect(
      addVolunteerPathEvidenceSchema.safeParse({
        evidenceId,
        requirementKey: 'volunteer_commendation',
      }).success,
    ).toBe(true);
    expect(
      addIntegrationPathResponseSchema.safeParse({
        requirementKey: 'social_practice_skill_course',
        evidenceId,
      }).success,
    ).toBe(true);
  });

  it('continues to reject empty or oversized requirement keys', () => {
    expect(
      addIntegrationPathResponseSchema.safeParse({ requirementKey: '', evidenceId }).success,
    ).toBe(false);
    expect(
      addIntegrationPathResponseSchema.safeParse({
        requirementKey: 'x'.repeat(201),
        evidenceId,
      }).success,
    ).toBe(false);
  });
});

import { Criterion, Level } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { currentCriteriaSeedConfigs } from '../../prisma/seeds/criteria/current.criteria';
import { officialCriteria, validateSeedCriteria } from '../../prisma/seeds/criteria/criteria.helpers';
import type { CriteriaRuleNode, SeedCriteriaRule } from '../../prisma/seeds/criteria/criteria.types';

describe('normalized criteria seed data', () => {
  it('defines exactly four current configs without year-based identity', () => {
    const summary = validateSeedCriteria(currentCriteriaSeedConfigs);
    expect(summary.errors).toEqual([]);
    expect(summary.configCount).toBe(4);
    expect(currentCriteriaSeedConfigs.map((config) => config.code).sort()).toEqual([
      'CENTRAL_CURRENT',
      'DANANG_CITY_CURRENT',
      'DUT_SCHOOL_CURRENT',
      'UDN_UNIVERSITY_CURRENT',
    ]);
    expect(currentCriteriaSeedConfigs.every((config) => !/\d{4}-\d{4}/.test(config.code))).toBe(true);
    expect(currentCriteriaSeedConfigs.every((config) => !config.sourceFileName.startsWith('/'))).toBe(true);
  });

  it('keeps every config scoped to the five official student criteria only', () => {
    for (const config of currentCriteriaSeedConfigs) {
      const mandatoryCriteria = new Set(
        config.rules.filter((rule) => rule.mandatory).map((rule) => rule.criterion),
      );
      expect(Array.from(mandatoryCriteria).sort()).toEqual([...officialCriteria].sort());
      expect(config.rules.some((seedRule) => (seedRule.criterion as Criterion) === Criterion.priority)).toBe(false);
      expect(config.rules.some((seedRule) => (seedRule.criterion as Criterion) === Criterion.collective)).toBe(false);
    }
  });

  it('preserves key DUT school AND and ANY structures', () => {
    const school = config(Level.school);
    expect(findRule(school.rules, 'ethics.conduct_score_82_and_no_violation').requirement).toMatchObject({
      type: 'ALL',
      children: expect.arrayContaining([
        expect.objectContaining({ type: 'THRESHOLD', metric: 'conduct_score', value: 82 }),
        expect.objectContaining({ type: 'NO_VIOLATION' }),
      ]),
    });
    expect(findRule(school.rules, 'academic.gpa_3_no_f').requirement).toMatchObject({
      type: 'ALL',
      children: expect.arrayContaining([
        expect.objectContaining({ type: 'THRESHOLD', metric: 'gpa', value: 3 }),
        expect.objectContaining({ type: 'BOOLEAN', key: 'academic.no_f_grade' }),
      ]),
    });
    expect(findRule(school.rules, 'volunteer.any_campaign_days_blood_award_activities').requirement).toMatchObject({
      type: 'ANY',
      minimumMatches: 1,
    });
    expect(findRule(school.rules, 'priority.academic_research').mandatory).toBe(false);
  });

  it('preserves UDN mandatory prerequisites and academic achievement branch', () => {
    const university = config(Level.university);
    expect(findRule(university.rules, 'prerequisite.school_title_and_recommendation').requirement).toMatchObject({
      type: 'ALL',
      children: expect.arrayContaining([
        expect.objectContaining({ type: 'PREREQUISITE_TITLE', scope: Level.school }),
        expect.objectContaining({ type: 'OFFICIAL_RECOMMENDATION' }),
      ]),
    });
    expect(findRule(university.rules, 'academic.gpa_3_2_and_achievement').requirement).toMatchObject({
      type: 'ALL',
      children: expect.arrayContaining([
        expect.objectContaining({ type: 'THRESHOLD', metric: 'gpa', value: 3.2 }),
        expect.objectContaining({ type: 'ANY', minimumMatches: 1 }),
      ]),
    });
  });

  it('keeps city and central volunteer requirements as ALL, not OR', () => {
    expect(findRule(config(Level.city).rules, 'volunteer.five_days_and_commendation').requirement).toMatchObject({
      type: 'ALL',
      children: expect.arrayContaining([
        expect.objectContaining({ type: 'ACTIVITY', minimumDays: 5 }),
        expect.objectContaining({ type: 'AWARD' }),
      ]),
    });
    expect(findRule(config(Level.central).rules, 'volunteer.central_five_days_and_commendation').requirement).toMatchObject({
      type: 'ALL',
      children: expect.arrayContaining([
        expect.objectContaining({ type: 'ACTIVITY', minimumDays: 5 }),
        expect.objectContaining({ type: 'AWARD' }),
      ]),
    });
  });

  it('preserves central physical appendix as manual-review reference data', () => {
    const centralPhysical = findRule(config(Level.central).rules, 'physical.central_any_branch_with_appendix_reference');
    expect(containsNode(centralPhysical.requirement, 'MANUAL_REVIEW_REQUIRED')).toBe(true);
  });
});

function config(scope: Level) {
  const found = currentCriteriaSeedConfigs.find((candidate) => candidate.scope === scope);
  if (!found) throw new Error(`Missing config ${scope}`);
  return found;
}

function findRule(rules: SeedCriteriaRule[], ruleKey: string) {
  const found = rules.find((rule) => rule.ruleKey === ruleKey);
  if (!found) throw new Error(`Missing rule ${ruleKey}`);
  return found;
}

function containsNode(node: CriteriaRuleNode, type: CriteriaRuleNode['type']): boolean {
  if (node.type === type) return true;
  if (node.type === 'ALL' || node.type === 'ANY') return node.children.some((child) => containsNode(child, type));
  return false;
}

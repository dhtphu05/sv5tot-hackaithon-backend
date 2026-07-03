import { Criterion, Level } from '@prisma/client';
import { centralRules } from './central.rules';
import { cityRules } from './city.rules';
import { schoolRules } from './school.rules';
import { universityRules } from './university.rules';
import type { CriteriaRuleConfig } from './rules.types';

export const defaultCriteriaUnitScope = 'DHBK-DHDN';

export const coreCriteria = [
  Criterion.ethics,
  Criterion.academic,
  Criterion.physical,
  Criterion.volunteer,
  Criterion.integration,
] as const;

export const levelOrderHighToLow = [
  Level.central,
  Level.city,
  Level.university,
  Level.school,
] as const;

export const activeLevelOrderHighToLow = [
  Level.city,
  Level.university,
  Level.school,
] as const;

export const fallbackRulesByLevel: Record<Level, CriteriaRuleConfig[]> = {
  [Level.school]: schoolRules,
  [Level.university]: universityRules,
  [Level.city]: cityRules,
  [Level.central]: centralRules,
};

export function getDownwardLevels(targetLevel: Level): Level[] {
  const start = levelOrderHighToLow.indexOf(targetLevel);
  return levelOrderHighToLow.slice(start);
}

export function getActiveDownwardLevels(targetLevel: Level): Level[] {
  const start = activeLevelOrderHighToLow.indexOf(
    targetLevel as (typeof activeLevelOrderHighToLow)[number],
  );
  return start >= 0 ? activeLevelOrderHighToLow.slice(start) : [];
}

export function getUpgradeLevels(targetLevel: Level): Level[] {
  const start = levelOrderHighToLow.indexOf(targetLevel);
  return levelOrderHighToLow.slice(0, start);
}

import type { Level } from '@prisma/client';
import { getDownwardLevels, getUpgradeLevels } from './criteria.constants';
import { generateNextBestAction } from './next-action.generator';
import { hasSevereBlockingMissing } from './readiness.scorer';
import { runPrecheck, type PrecheckEngineResult } from './precheck.engine';
import type { RuleContext } from './rules.types';

export type CascadeEngineInput = {
  baseContext: Omit<
    RuleContext,
    'criteriaRules' | 'targetLevel' | 'criteriaVersion' | 'criteriaWarnings'
  >;
  targetLevel: Level;
  includeUpgradeHints?: boolean;
  getContextForLevel: (level: Level) => RuleContext;
};

export type CascadeEngineResult = {
  targetLevel: Level;
  suggestedLevel: Level | null;
  levelResults: PrecheckEngineResult[];
  upgradeHints: PrecheckEngineResult[];
  nextBestAction: string;
  humanConfirmationRequired: true;
};

export function runCascadeReview(input: CascadeEngineInput): CascadeEngineResult {
  const downwardLevels = getDownwardLevels(input.targetLevel);
  const levelResults = downwardLevels.map((level) => runPrecheck(input.getContextForLevel(level)));
  const suggested = levelResults.find(
    (result) => result.readinessScore >= 60 && !hasSevereBlockingMissing(result.missingItems),
  );
  const upgradeHints = input.includeUpgradeHints
    ? getUpgradeLevels(input.targetLevel).map((level) =>
        runPrecheck(input.getContextForLevel(level)),
      )
    : [];

  const firstResult = levelResults[0];
  const nextBestAction = generateNextBestAction({
    criteriaResults: firstResult.criteriaResults,
    targetLevel: input.targetLevel,
    missingItems: firstResult.missingItems,
    warnings: firstResult.warnings,
    readyToSubmit: suggested?.level === input.targetLevel && firstResult.readyToSubmit,
  });

  return {
    targetLevel: input.targetLevel,
    suggestedLevel: suggested?.level ?? null,
    levelResults,
    upgradeHints,
    nextBestAction,
    humanConfirmationRequired: true,
  };
}

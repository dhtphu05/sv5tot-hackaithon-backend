import type { Level, Prisma } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { ErrorCodes } from '../../shared/errors/error-codes';
import { defaultCriteriaUnitScope, fallbackRulesByLevel } from './criteria.constants';
import type { CriteriaRuleBundle } from './rules.types';

export async function loadCriteriaRules(input: {
  workspaceId: string;
  schoolYear: string;
  level: Level;
  unitScope?: string;
}): Promise<CriteriaRuleBundle> {
  const unitScope = input.unitScope ?? defaultCriteriaUnitScope;
  const version = await prisma.criteriaVersion.findFirst({
    where: {
      workspaceId: input.workspaceId,
      schoolYear: input.schoolYear,
      level: input.level,
      unitScope,
      isActive: true,
    },
    include: {
      rules: {
        orderBy: [{ criterion: 'asc' }, { ruleKey: 'asc' }],
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return toCriteriaRuleBundle(version, input.level, input.schoolYear, unitScope);
}

export async function loadCriteriaRulesForLevels(input: {
  workspaceId: string;
  schoolYear: string;
  levels: Level[];
  unitScope?: string;
}): Promise<CriteriaRuleBundle[]> {
  const unitScope = input.unitScope ?? defaultCriteriaUnitScope;
  const versions = await prisma.criteriaVersion.findMany({
    where: {
      workspaceId: input.workspaceId,
      schoolYear: input.schoolYear,
      level: { in: input.levels },
      unitScope,
      isActive: true,
    },
    include: {
      rules: {
        orderBy: [{ criterion: 'asc' }, { ruleKey: 'asc' }],
      },
    },
    orderBy: [{ level: 'asc' }, { createdAt: 'desc' }],
  });
  const newestByLevel = new Map<Level, (typeof versions)[number]>();
  for (const version of versions) {
    if (!newestByLevel.has(version.level)) newestByLevel.set(version.level, version);
  }

  return input.levels.map((level) =>
    toCriteriaRuleBundle(newestByLevel.get(level) ?? null, level, input.schoolYear, unitScope),
  );
}

function toCriteriaRuleBundle(
  version: Prisma.CriteriaVersionGetPayload<{ include: { rules: true } }> | null,
  level: Level,
  schoolYear: string,
  unitScope: string,
): CriteriaRuleBundle {
  if (!version || version.rules.length === 0) {
    return {
      criteriaVersionId: null,
      versionName: `fallback-${level}`,
      schoolYear,
      unitScope,
      level,
      isFallback: true,
      warnings: [ErrorCodes.CRITERIA_VERSION_NOT_FOUND],
      rules: fallbackRulesByLevel[level],
    };
  }

  return {
    criteriaVersionId: version.id,
    versionName: version.versionName,
    schoolYear: version.schoolYear,
    unitScope: version.unitScope,
    level,
    isFallback: false,
    warnings: [],
    rules: version.rules.map((rule) => ({
      criterion: rule.criterion,
      ruleKey: rule.ruleKey,
      ruleType: rule.ruleType,
      thresholdJson: rule.thresholdJson,
      evidenceRequirementsJson: rule.evidenceRequirementsJson,
      humanReadableText: rule.humanReadableText,
    })),
  };
}

export function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

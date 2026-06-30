import type { Level, Prisma } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { ErrorCodes } from '../../shared/errors/error-codes';
import { defaultCriteriaUnitScope, fallbackRulesByLevel } from './criteria.constants';
import type { CriteriaRuleBundle } from './rules.types';

export async function loadCriteriaRules(input: {
  schoolYear: string;
  level: Level;
  unitScope?: string;
}): Promise<CriteriaRuleBundle> {
  const unitScope = input.unitScope ?? defaultCriteriaUnitScope;
  const version = await prisma.criteriaVersion.findFirst({
    where: {
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

  if (!version || version.rules.length === 0) {
    return {
      criteriaVersionId: null,
      versionName: `fallback-${input.level}`,
      schoolYear: input.schoolYear,
      unitScope,
      level: input.level,
      isFallback: true,
      warnings: [ErrorCodes.CRITERIA_VERSION_NOT_FOUND],
      rules: fallbackRulesByLevel[input.level],
    };
  }

  return {
    criteriaVersionId: version.id,
    versionName: version.versionName,
    schoolYear: version.schoolYear,
    unitScope: version.unitScope,
    level: version.level,
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

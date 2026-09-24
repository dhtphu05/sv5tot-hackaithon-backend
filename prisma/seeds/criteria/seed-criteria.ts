import { Prisma, PrismaClient } from '@prisma/client';
import { logger } from '../../../src/config/logger';
import { prisma as defaultPrisma } from '../../../src/infrastructure/database/prisma';
import { currentCriteriaSeedConfigs } from './current.criteria';
import { validateSeedCriteria } from './criteria.helpers';
import type { CriteriaSeedValidationSummary, SeedCriteriaConfig } from './criteria.types';

type SeedClient = PrismaClient | Prisma.TransactionClient;

export type NormalizedCriteriaSeedResult = CriteriaSeedValidationSummary & {
  syncedConfigCodes: string[];
  deactivatedRuleCount: number;
};

export async function seedNormalizedCriteria(
  client: PrismaClient = defaultPrisma,
  configs: SeedCriteriaConfig[] = currentCriteriaSeedConfigs,
): Promise<NormalizedCriteriaSeedResult> {
  const validation = validateSeedCriteria(configs);
  if (validation.errors.length > 0) {
    throw new Error(`Normalized criteria seed validation failed:\n${validation.errors.join('\n')}`);
  }

  const syncedConfigCodes: string[] = [];
  let deactivatedRuleCount = 0;
  await client.$transaction(async (tx) => {
    for (const config of configs) {
      const workspaceId = await resolveWorkspaceId(tx, config);
      const criteriaConfig = await tx.criteriaConfig.upsert({
        where: { code: config.code },
        create: {
          scope: config.scope,
          workspaceId,
          code: config.code,
          title: config.title,
          description: config.description ?? null,
          sourceDocumentName: config.sourceDocumentName,
          sourceDocumentNumber: config.sourceDocumentNumber ?? null,
          sourceIssuedAt: config.sourceIssuedAt ? new Date(`${config.sourceIssuedAt}T00:00:00.000Z`) : null,
          sourcePeriodLabel: config.sourcePeriodLabel ?? null,
          sourceOrganization: config.sourceOrganization,
          sourceFileName: config.sourceFileName,
          sourceNote: config.sourceNote ?? null,
          isActive: true,
        },
        update: {
          scope: config.scope,
          workspaceId,
          title: config.title,
          description: config.description ?? null,
          sourceDocumentName: config.sourceDocumentName,
          sourceDocumentNumber: config.sourceDocumentNumber ?? null,
          sourceIssuedAt: config.sourceIssuedAt ? new Date(`${config.sourceIssuedAt}T00:00:00.000Z`) : null,
          sourcePeriodLabel: config.sourcePeriodLabel ?? null,
          sourceOrganization: config.sourceOrganization,
          sourceFileName: config.sourceFileName,
          sourceNote: config.sourceNote ?? null,
          isActive: true,
        },
      });

      const activeRuleKeys = new Set(config.rules.map((rule) => rule.ruleKey));
      for (const seedRule of config.rules) {
        await tx.normalizedCriteriaRule.upsert({
          where: {
            criteriaConfigId_ruleKey: {
              criteriaConfigId: criteriaConfig.id,
              ruleKey: seedRule.ruleKey,
            },
          },
          create: {
            criteriaConfigId: criteriaConfig.id,
            criterion: seedRule.criterion,
            ruleKey: seedRule.ruleKey,
            title: seedRule.title,
            requirementJson: toJson(seedRule.requirement),
            mandatory: seedRule.mandatory,
            priorityRule: seedRule.priorityRule ?? false,
            studentFriendlyText: seedRule.studentFriendlyText,
            officerFriendlyText: seedRule.officerFriendlyText ?? null,
            acceptedEvidenceHintsJson: toNullableJson(seedRule.acceptedEvidenceHints),
            missingActionHintsJson: toNullableJson(seedRule.missingActionHints),
            sourcePage: seedRule.sourcePage ?? null,
            sourceSection: seedRule.sourceSection ?? null,
            sourceQuote: seedRule.sourceQuote ?? null,
            sortOrder: seedRule.sortOrder,
            isActive: true,
          },
          update: {
            criterion: seedRule.criterion,
            title: seedRule.title,
            requirementJson: toJson(seedRule.requirement),
            mandatory: seedRule.mandatory,
            priorityRule: seedRule.priorityRule ?? false,
            studentFriendlyText: seedRule.studentFriendlyText,
            officerFriendlyText: seedRule.officerFriendlyText ?? null,
            acceptedEvidenceHintsJson: toNullableJson(seedRule.acceptedEvidenceHints),
            missingActionHintsJson: toNullableJson(seedRule.missingActionHints),
            sourcePage: seedRule.sourcePage ?? null,
            sourceSection: seedRule.sourceSection ?? null,
            sourceQuote: seedRule.sourceQuote ?? null,
            sortOrder: seedRule.sortOrder,
            isActive: true,
          },
        });
      }

      const deactivated = await tx.normalizedCriteriaRule.updateMany({
        where: {
          criteriaConfigId: criteriaConfig.id,
          ruleKey: { notIn: Array.from(activeRuleKeys) },
          isActive: true,
        },
        data: { isActive: false },
      });
      deactivatedRuleCount += deactivated.count;
      syncedConfigCodes.push(config.code);
    }
  });

  const result = {
    ...validation,
    syncedConfigCodes,
    deactivatedRuleCount,
  };
  logger.info(
    {
      configCount: result.configCount,
      ruleCount: result.ruleCount,
      mandatoryCount: result.mandatoryCount,
      priorityCount: result.priorityCount,
      manualReviewCount: result.manualReviewCount,
      deactivatedRuleCount,
    },
    'Normalized criteria seed synchronized',
  );
  return result;
}

async function resolveWorkspaceId(tx: SeedClient, config: SeedCriteriaConfig): Promise<string | null> {
  if (!config.workspaceCode) return null;
  const workspace = await tx.workspace.findUnique({
    where: { code: config.workspaceCode },
    select: { id: true },
  });
  if (!workspace) {
    throw new Error(`Workspace ${config.workspaceCode} is required for ${config.code}`);
  }
  return workspace.id;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function toNullableJson(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return toJson(value);
}

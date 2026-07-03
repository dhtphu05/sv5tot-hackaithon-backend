// Owns target-level cascade analysis and human confirmation state.
import type { Level } from '@prisma/client';
import { Role } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { auditActions } from '../../shared/constants/application';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { createApplicationAudit } from '../applications/application.helpers';
import { loadCriteriaRules, toJsonValue } from '../rules/criteria.loader';
import { getActiveDownwardLevels, getUpgradeLevels } from '../rules/criteria.constants';
import { runPrecheck, type PrecheckEngineResult } from '../rules/precheck.engine';
import type { RuleContext } from '../rules/rules.types';
import { assertPrecheckAccess, buildRuleContext } from '../precheck/precheck.service';
import { CascadeRepository } from './cascade.repository';
import type { RunCascadeReviewInput } from './cascade.validation';

export class CascadeService {
  constructor(private readonly cascadeRepository = new CascadeRepository()) {}

  async run(user: AuthenticatedUser, applicationId: string, input: RunCascadeReviewInput) {
    const application = await this.getApplication(applicationId);
    assertPrecheckAccess(application, user, false);

    const cascade = await computeActiveCascadeSnapshot(application);

    const upgradeHints: PrecheckEngineResult[] = [];
    if (input.includeUpgradeHints) {
      for (const level of getUpgradeLevels(application.targetLevel)) {
        upgradeHints.push(await this.runLevel(application, level));
      }
    }

    const result = {
      applicationId: application.id,
      targetLevel: application.targetLevel,
      suggestedLevel: cascade.suggestedLevel,
      humanConfirmationRequired: true,
      levelResults: cascade.levelResults,
      blockers: cascade.blockers,
      stoppedAtLevel: cascade.stoppedAtLevel,
      upgradeHints,
      nextAction: cascade.nextAction,
      nextBestAction: cascade.nextAction,
    };

    const saved = await prisma.$transaction(async (tx) => {
      const created = await tx.cascadeReview.create({
        data: {
          applicationId: application.id,
          targetLevel: application.targetLevel,
          suggestedLevel: cascade.suggestedLevel,
          humanConfirmationRequired: true,
          levelResultsJson: toJsonValue({
            levelResults: cascade.levelResults,
            blockers: cascade.blockers,
            stoppedAtLevel: cascade.stoppedAtLevel,
            upgradeHints,
            nextAction: cascade.nextAction,
            nextBestAction: cascade.nextAction,
            note: 'Kết quả là gợi ý tiền kiểm, không phải quyết định xét duyệt cuối cùng.',
          }),
        },
      });

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.CASCADE_REVIEW_COMPLETED,
        targetType: 'cascade_review',
        targetId: created.id,
        applicationId: application.id,
        afterStateJson: {
          targetLevel: application.targetLevel,
          suggestedLevel: cascade.suggestedLevel,
          stoppedAtLevel: cascade.stoppedAtLevel,
          levelCount: cascade.levelResults.length,
          upgradeHintCount: upgradeHints.length,
        },
        note: `Cascade target=${application.targetLevel}, suggested=${cascade.suggestedLevel ?? 'none'}`,
      });

      return created;
    });

    return {
      ...result,
      createdAt: saved.createdAt,
    };
  }

  async getLatest(user: AuthenticatedUser, applicationId: string) {
    const application = await this.getApplication(applicationId);
    assertPrecheckAccess(application, user, true);
    return this.cascadeRepository.findLatest(application.id);
  }

  private async runLevel(
    application: NonNullable<Awaited<ReturnType<CascadeRepository['findApplicationContext']>>>,
    level: Level,
  ): Promise<PrecheckEngineResult> {
    const criteria = await loadCriteriaRules({ schoolYear: application.schoolYear, level });
    const context: RuleContext = {
      ...buildRuleContext(application, criteria.rules),
      targetLevel: level,
      criteriaVersion: criteria.criteriaVersionId
        ? { id: criteria.criteriaVersionId, versionName: criteria.versionName }
        : null,
      criteriaWarnings: criteria.warnings,
    };
    return runPrecheck(context);
  }

  private async getApplication(applicationId: string) {
    const application = await this.cascadeRepository.findApplicationContext(applicationId);
    if (!application) {
      throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
    }
    if (!application.targetLevel) {
      throw new AppError(400, ErrorCodes.TARGET_LEVEL_REQUIRED, 'Target level is required');
    }
    return application;
  }
}

type ActiveCascadeApplication = Parameters<typeof buildRuleContext>[0] & {
  targetLevel: Level;
  schoolYear: string;
};

export type ActiveCascadeSnapshot = {
  targetLevel: Level;
  suggestedLevel: Level | null;
  levelResults: PrecheckEngineResult[];
  blockers: Array<{
    level: Level;
    messages: string[];
  }>;
  stoppedAtLevel: Level | null;
  nextAction: string;
  recomputedAt: string;
};

export async function computeActiveCascadeSnapshot(
  application: ActiveCascadeApplication,
): Promise<ActiveCascadeSnapshot> {
  const levels = getActiveDownwardLevels(application.targetLevel);
  if (!levels.length) {
    throw new AppError(
      422,
      ErrorCodes.CENTRAL_OUT_OF_ACTIVE_FLOW,
      'Target level is outside the active city/university/school flow',
      { targetLevel: application.targetLevel },
    );
  }

  const levelResults: PrecheckEngineResult[] = [];
  const blockers: ActiveCascadeSnapshot['blockers'] = [];
  let suggestedLevel: Level | null = null;
  let stoppedAtLevel: Level | null = null;

  for (const level of levels) {
    const criteria = await loadCriteriaRules({ schoolYear: application.schoolYear, level });
    const context: RuleContext = {
      ...buildRuleContext(application, criteria.rules),
      targetLevel: level,
      criteriaVersion: criteria.criteriaVersionId
        ? { id: criteria.criteriaVersionId, versionName: criteria.versionName }
        : null,
      criteriaWarnings: criteria.warnings,
    };
    const result = runPrecheck(context);
    levelResults.push(result);

    const blockingMessages = result.missingItems
      .filter((item) => item.severity === 'blocking')
      .map((item) => item.message);
    blockers.push({ level, messages: blockingMessages });

    if (result.readinessScore >= 60 && blockingMessages.length === 0) {
      suggestedLevel = level;
      stoppedAtLevel = level;
      break;
    }
  }

  if (!stoppedAtLevel && levelResults.length > 0) {
    stoppedAtLevel = levelResults[levelResults.length - 1].level;
  }

  const lastResult = levelResults[levelResults.length - 1];
  const nextAction = suggestedLevel
    ? `Ready to finalize at level ${suggestedLevel}.`
    : (lastResult?.nextBestAction ?? 'No active level is currently eligible.');

  return {
    targetLevel: application.targetLevel,
    suggestedLevel,
    levelResults,
    blockers,
    stoppedAtLevel,
    nextAction,
    recomputedAt: new Date().toISOString(),
  };
}

export function canRunCascade(role: Role): boolean {
  return [
    Role.student,
    Role.class_representative,
    Role.officer,
    Role.manager,
    Role.committee,
    Role.admin,
  ].includes(role);
}

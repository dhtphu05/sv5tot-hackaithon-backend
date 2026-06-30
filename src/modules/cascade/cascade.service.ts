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
import { getDownwardLevels, getUpgradeLevels } from '../rules/criteria.constants';
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

    const levelResults: PrecheckEngineResult[] = [];
    for (const level of getDownwardLevels(application.targetLevel)) {
      levelResults.push(await this.runLevel(application, level));
    }

    const upgradeHints: PrecheckEngineResult[] = [];
    if (input.includeUpgradeHints) {
      for (const level of getUpgradeLevels(application.targetLevel)) {
        upgradeHints.push(await this.runLevel(application, level));
      }
    }

    const suggestedLevel =
      levelResults.find(
        (result) =>
          result.readinessScore >= 60 &&
          !result.missingItems.some((item) => item.severity === 'blocking'),
      )?.level ?? null;

    const targetResult = levelResults[0];
    const result = {
      applicationId: application.id,
      targetLevel: application.targetLevel,
      suggestedLevel,
      humanConfirmationRequired: true,
      levelResults,
      upgradeHints,
      nextBestAction: targetResult.nextBestAction,
    };

    const saved = await prisma.$transaction(async (tx) => {
      const created = await tx.cascadeReview.create({
        data: {
          applicationId: application.id,
          targetLevel: application.targetLevel,
          suggestedLevel,
          humanConfirmationRequired: true,
          levelResultsJson: toJsonValue({
            levelResults,
            upgradeHints,
            nextBestAction: targetResult.nextBestAction,
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
          suggestedLevel,
          levelCount: levelResults.length,
          upgradeHintCount: upgradeHints.length,
        },
        note: `Cascade target=${application.targetLevel}, suggested=${suggestedLevel ?? 'none'}`,
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

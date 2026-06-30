// Owns AI-assisted precheck orchestration results for applications.
import {
  ApplicationStatus,
  EvidenceSourceType,
  Role,
  type Application,
  type User,
} from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { auditActions } from '../../shared/constants/application';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { createApplicationAudit } from '../applications/application.helpers';
import { loadCriteriaRules, toJsonValue } from '../rules/criteria.loader';
import { runPrecheck } from '../rules/precheck.engine';
import type { RuleContext } from '../rules/rules.types';
import { PrecheckRepository } from './precheck.repository';
import type { RunPrecheckInput } from './precheck.validation';

export class PrecheckService {
  constructor(private readonly precheckRepository = new PrecheckRepository()) {}

  async run(user: AuthenticatedUser, applicationId: string, input: RunPrecheckInput) {
    const application = await this.getApplication(applicationId);
    assertPrecheckAccess(application, user, false);
    const level = input.level ?? application.targetLevel;
    const criteria = await loadCriteriaRules({ schoolYear: application.schoolYear, level });
    const result = runPrecheck({
      ...buildRuleContext(application, criteria.rules),
      targetLevel: level,
      criteriaVersion: criteria.criteriaVersionId
        ? { id: criteria.criteriaVersionId, versionName: criteria.versionName }
        : null,
      criteriaWarnings: criteria.warnings,
    });

    const created = await prisma.$transaction(async (tx) => {
      const saved = await tx.precheckResult.create({
        data: {
          applicationId: application.id,
          readinessScore: result.readinessScore,
          missingItemsJson: toJsonValue(result.missingItems),
          nextBestAction: result.nextBestAction,
          resultJson: toJsonValue({
            ...result,
            criteriaVersion: criteria,
            note: 'Kết quả là gợi ý tiền kiểm, không phải quyết định xét duyệt cuối cùng.',
          }),
        },
      });

      const nextStatus = getNextPrecheckStatus(application.status, result.readyToSubmit);
      await tx.application.update({
        where: { id: application.id },
        data: {
          readinessScore: result.readinessScore,
          ...(nextStatus ? { status: nextStatus } : {}),
        },
      });

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.PRECHECK_COMPLETED,
        targetType: 'precheck_result',
        targetId: saved.id,
        applicationId: application.id,
        afterStateJson: {
          level,
          readinessScore: result.readinessScore,
          missingCount: result.missingItems.length,
          readyToSubmit: result.readyToSubmit,
          criteriaVersionId: criteria.criteriaVersionId,
          status: nextStatus ?? application.status,
        },
        note: `Precheck ${level}: readinessScore=${result.readinessScore}, missing=${result.missingItems.length}`,
      });

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.APPLICATION_READINESS_UPDATED,
        targetType: 'application',
        targetId: application.id,
        applicationId: application.id,
        beforeStateJson: { readinessScore: application.readinessScore, status: application.status },
        afterStateJson: {
          readinessScore: result.readinessScore,
          status: nextStatus ?? application.status,
        },
      });

      return saved;
    });

    return {
      applicationId: application.id,
      level,
      readinessScore: result.readinessScore,
      readyToSubmit: result.readyToSubmit,
      criteriaResults: result.criteriaResults,
      missingItems: result.missingItems,
      warnings: result.warnings,
      nextBestAction: result.nextBestAction,
      humanConfirmationRequired: true,
      createdAt: created.createdAt,
    };
  }

  async getLatest(user: AuthenticatedUser, applicationId: string) {
    const application = await this.getApplication(applicationId);
    assertPrecheckAccess(application, user, true);
    return this.precheckRepository.findLatest(application.id);
  }

  private async getApplication(applicationId: string) {
    const application = await this.precheckRepository.findApplicationContext(applicationId);
    if (!application) {
      throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
    }
    return application;
  }
}

type PrecheckApplication = Awaited<ReturnType<PrecheckRepository['findApplicationContext']>> & {};

export function buildRuleContext(
  application: NonNullable<PrecheckApplication>,
  criteriaRules: RuleContext['criteriaRules'],
): Omit<RuleContext, 'targetLevel' | 'criteriaVersion' | 'criteriaWarnings'> {
  const evidenceCards = application.evidences
    .map((evidence) => evidence.evidenceCard)
    .filter((card): card is NonNullable<typeof card> => Boolean(card));
  const eventImports = application.evidences.filter(
    (evidence) => evidence.sourceType === EvidenceSourceType.event_import,
  );

  return {
    application,
    metrics: application.metrics,
    evidences: application.evidences,
    evidenceCards,
    eventImports,
    criteriaRules,
    schoolYear: application.schoolYear,
  };
}

export function assertPrecheckAccess(
  application: Application & { student: User },
  user: AuthenticatedUser,
  viewOnly: boolean,
): void {
  if (application.studentId === user.id || user.role === Role.admin || user.role === Role.manager) {
    return;
  }
  if (viewOnly && user.role === Role.committee) {
    return;
  }
  if (user.role === Role.officer || user.role === Role.committee) {
    if (
      user.faculty &&
      application.student.faculty &&
      user.faculty === application.student.faculty
    ) {
      return;
    }
  }

  throw new AppError(403, ErrorCodes.FORBIDDEN, 'You do not have access to this application');
}

function getNextPrecheckStatus(
  status: ApplicationStatus,
  readyToSubmit: boolean,
): ApplicationStatus | null {
  if (
    status !== ApplicationStatus.draft &&
    status !== ApplicationStatus.prechecked &&
    status !== ApplicationStatus.ready_to_submit
  ) {
    return null;
  }
  return readyToSubmit ? ApplicationStatus.ready_to_submit : ApplicationStatus.prechecked;
}

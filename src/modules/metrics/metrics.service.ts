// Owns application metric capture and verification state.
import { Role, VerificationStatus } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { auditActions } from '../../shared/constants/application';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import {
  assertApplicationEditable,
  assertApplicationOwner,
  createApplicationAudit,
} from '../applications/application.helpers';
import { MetricsRepository } from './metrics.repository';
import {
  assertMetricValue,
  type UpdateMetricInput,
  type UpsertMetricInput,
} from './metrics.validation';

export class MetricsService {
  constructor(private readonly metricsRepository = new MetricsRepository()) {}

  async upsertMetric(user: AuthenticatedUser, applicationId: string, input: UpsertMetricInput) {
    const application = await this.metricsRepository.findApplicationById(applicationId);
    if (!application) {
      throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
    }

    assertApplicationOwner(application, user);
    assertApplicationEditable(application);

    const existing = await this.metricsRepository.findMetric(applicationId, input.metricType);

    const metric = await prisma.$transaction(async (tx) => {
      const saved = await this.metricsRepository.upsertMetric(
        {
          applicationId,
          metricType: input.metricType,
          value: input.value,
          scale: input.scale,
        },
        tx,
      );

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: existing ? auditActions.METRIC_UPDATED : auditActions.METRIC_UPSERTED,
        targetType: 'metric',
        targetId: saved.id,
        applicationId,
        beforeStateJson: existing
          ? { value: existing.value, scale: existing.scale, metricType: existing.metricType }
          : undefined,
        afterStateJson: {
          value: saved.value,
          scale: saved.scale,
          metricType: saved.metricType,
          verificationStatus: saved.verificationStatus,
        },
      });

      return saved;
    });

    return {
      metric,
      application: {
        id: application.id,
        readinessScore: application.readinessScore,
      },
    };
  }

  async updateMetric(user: AuthenticatedUser, metricId: string, input: UpdateMetricInput) {
    const existing = await this.metricsRepository.findMetricById(metricId);
    if (!existing) {
      throw new AppError(404, ErrorCodes.METRIC_NOT_FOUND, 'Metric not found');
    }

    const isOwner = existing.application.studentId === user.id;
    const isVerifier = user.role === Role.manager || user.role === Role.admin;

    if (!isOwner && !isVerifier) {
      throw new AppError(
        403,
        ErrorCodes.APPLICATION_OWNER_REQUIRED,
        'Metric belongs to another user',
      );
    }

    if (isOwner && (input.value !== undefined || input.scale !== undefined)) {
      assertApplicationEditable(existing.application);
    }

    if (input.verificationStatus && !isVerifier) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Only manager or admin can verify metrics');
    }

    if (input.value !== undefined) {
      assertMetricValue(
        existing.metricType,
        input.value,
        input.scale ?? existing.scale ?? undefined,
      );
    }

    if (!isOwner && (input.value !== undefined || input.scale !== undefined)) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Only owner can update metric values');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.applicationMetric.update({
        where: { id: metricId },
        data: {
          ...(input.value !== undefined ? { value: input.value } : {}),
          ...(input.scale !== undefined ? { scale: input.scale } : {}),
          ...(input.verificationStatus ? { verificationStatus: input.verificationStatus } : {}),
        },
      });

      const verificationChanged =
        input.verificationStatus !== undefined &&
        input.verificationStatus !== existing.verificationStatus;

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: verificationChanged ? auditActions.METRIC_VERIFIED : auditActions.METRIC_UPDATED,
        targetType: 'metric',
        targetId: saved.id,
        applicationId: existing.applicationId,
        beforeStateJson: {
          value: existing.value,
          scale: existing.scale,
          verificationStatus: existing.verificationStatus,
        },
        afterStateJson: {
          value: saved.value,
          scale: saved.scale,
          verificationStatus: saved.verificationStatus,
        },
      });

      return saved;
    });

    return updated;
  }

  assertVerificationStatus(status: VerificationStatus): VerificationStatus {
    return status;
  }
}

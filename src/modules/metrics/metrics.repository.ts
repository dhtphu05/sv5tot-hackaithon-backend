// Owns application metric capture and verification state.
import type { MetricType, Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';

export class MetricsRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  findApplicationById(id: string) {
    return this.db.application.findUnique({ where: { id } });
  }

  findMetric(applicationId: string, metricType: MetricType) {
    return this.db.applicationMetric.findUnique({
      where: {
        applicationId_metricType: {
          applicationId,
          metricType,
        },
      },
    });
  }

  findMetricById(id: string) {
    return this.db.applicationMetric.findUnique({
      where: { id },
      include: { application: true },
    });
  }

  upsertMetric(
    input: {
      applicationId: string;
      metricType: MetricType;
      value: number;
      scale?: number;
    },
    tx: Prisma.TransactionClient,
  ) {
    return tx.applicationMetric.upsert({
      where: {
        applicationId_metricType: {
          applicationId: input.applicationId,
          metricType: input.metricType,
        },
      },
      update: {
        value: input.value,
        scale: input.scale,
      },
      create: {
        applicationId: input.applicationId,
        metricType: input.metricType,
        value: input.value,
        scale: input.scale,
      },
    });
  }
}

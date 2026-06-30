import { MetricType, VerificationStatus } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';

const scaleSchema = z
  .union([z.string(), z.number()])
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined;
    }
    return typeof value === 'number' ? value : Number(value);
  });

export function assertMetricValue(metricType: MetricType, value: number, scale?: number): void {
  if (metricType === MetricType.gpa) {
    const gpaScale = scale ?? 4.0;
    if (gpaScale === 4.0 && (value < 0 || value > 4)) {
      throw new AppError(400, ErrorCodes.INVALID_METRIC_VALUE, 'GPA must be between 0 and 4');
    }
    if (gpaScale === 10.0 && (value < 0 || value > 10)) {
      throw new AppError(400, ErrorCodes.INVALID_METRIC_VALUE, 'GPA must be between 0 and 10');
    }
    if (![4.0, 10.0].includes(gpaScale)) {
      throw new AppError(400, ErrorCodes.INVALID_METRIC_VALUE, 'GPA scale must be 4.0 or 10.0');
    }
  }

  if (metricType === MetricType.conduct_score && (value < 0 || value > 100)) {
    throw new AppError(
      400,
      ErrorCodes.INVALID_METRIC_VALUE,
      'Conduct score must be between 0 and 100',
    );
  }

  if (metricType === MetricType.physical_score && (value < 0 || value > 10)) {
    throw new AppError(
      400,
      ErrorCodes.INVALID_METRIC_VALUE,
      'Physical score must be between 0 and 10',
    );
  }

  if (
    (metricType === MetricType.volunteer_days ||
      metricType === MetricType.foreign_language_score) &&
    value < 0
  ) {
    throw new AppError(400, ErrorCodes.INVALID_METRIC_VALUE, 'Metric value must be non-negative');
  }
}

export const upsertMetricSchema = z
  .object({
    metricType: z.nativeEnum(MetricType),
    value: z.number(),
    scale: scaleSchema,
  })
  .superRefine((value) => {
    assertMetricValue(value.metricType, value.value, value.scale);
  });

export const updateMetricSchema = z
  .object({
    value: z.number().optional(),
    scale: scaleSchema,
    verificationStatus: z.nativeEnum(VerificationStatus).optional(),
  })
  .superRefine((value) => {
    if (value.value === undefined && value.verificationStatus === undefined) {
      throw new AppError(
        400,
        ErrorCodes.VALIDATION_ERROR,
        'Either value or verificationStatus is required',
      );
    }
  });

export type UpsertMetricInput = z.infer<typeof upsertMetricSchema>;
export type UpdateMetricInput = z.infer<typeof updateMetricSchema>;

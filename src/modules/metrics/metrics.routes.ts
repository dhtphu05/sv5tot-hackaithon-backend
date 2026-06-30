import { Role } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import { updateApplicationMetric, upsertApplicationMetric } from './metrics.controller';
import { updateMetricSchema, upsertMetricSchema } from './metrics.validation';

export const metricsRouter = Router();

metricsRouter.post(
  '/applications/:id/metrics',
  requireAuth,
  requireRole(Role.student, Role.class_representative),
  validate({ body: upsertMetricSchema }),
  asyncHandler(upsertApplicationMetric),
);
metricsRouter.patch(
  '/metrics/:metricId',
  requireAuth,
  requireRole(Role.student, Role.class_representative, Role.manager, Role.admin),
  validate({ body: updateMetricSchema }),
  asyncHandler(updateApplicationMetric),
);

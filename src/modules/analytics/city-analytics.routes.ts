import { Role } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import { getCityAnalytics, listCityAnalyticsApplications } from './city-analytics.controller';
import { cityAnalyticsApplicationsQuerySchema, cityAnalyticsQuerySchema } from './city-analytics.validation';

export const analyticsRouter = Router();

analyticsRouter.get(
  '/city',
  requireAuth,
  requireRole(Role.city_manager, Role.city_committee, Role.admin),
  validate({ query: cityAnalyticsQuerySchema }),
  asyncHandler(getCityAnalytics),
);
analyticsRouter.get(
  '/city/applications',
  requireAuth,
  requireRole(Role.city_manager, Role.city_committee, Role.admin),
  validate({ query: cityAnalyticsApplicationsQuerySchema }),
  asyncHandler(listCityAnalyticsApplications),
);

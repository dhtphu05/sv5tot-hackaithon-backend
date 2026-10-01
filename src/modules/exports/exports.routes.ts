import { Role } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import {
  downloadExportFile,
  exportApplicationsCsv,
  exportApplicationsJson,
  exportReviewResults,
  exportReviewTasksCsv,
  exportReviewTasksJson,
} from './exports.controller';
import {
  exportApplicationsQuerySchema,
  exportReviewResultsSchema,
  exportReviewTasksQuerySchema,
} from './exports.validation';

export const exportsRouter = Router();

exportsRouter.get(
  '/applications.json',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.city_manager, Role.city_committee, Role.admin),
  validate({ query: exportApplicationsQuerySchema }),
  asyncHandler(exportApplicationsJson),
);
exportsRouter.get(
  '/applications.csv',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.city_manager, Role.city_committee, Role.admin),
  validate({ query: exportApplicationsQuerySchema }),
  asyncHandler(exportApplicationsCsv),
);
exportsRouter.get(
  '/review-tasks.csv',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.city_manager, Role.city_committee, Role.admin),
  validate({ query: exportReviewTasksQuerySchema }),
  asyncHandler(exportReviewTasksCsv),
);
exportsRouter.get(
  '/review-tasks.json',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.city_manager, Role.city_committee, Role.admin),
  validate({ query: exportReviewTasksQuerySchema }),
  asyncHandler(exportReviewTasksJson),
);
exportsRouter.post(
  '/review-results',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.city_manager, Role.city_committee, Role.admin),
  validate({ body: exportReviewResultsSchema }),
  asyncHandler(exportReviewResults),
);
exportsRouter.get(
  '/:fileId/download',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.city_manager, Role.city_committee, Role.admin),
  asyncHandler(downloadExportFile),
);

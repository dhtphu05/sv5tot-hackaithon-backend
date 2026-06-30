import { Role } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import { downloadExportFile, exportReviewResults } from './exports.controller';
import { exportReviewResultsSchema } from './exports.validation';

export const exportsRouter = Router();

exportsRouter.post(
  '/review-results',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.admin),
  validate({ body: exportReviewResultsSchema }),
  asyncHandler(exportReviewResults),
);
exportsRouter.get(
  '/:fileId/download',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.admin),
  asyncHandler(downloadExportFile),
);

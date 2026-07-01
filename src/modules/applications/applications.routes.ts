import { Role } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import {
  autosaveApplicationDraft,
  getApplicationTimeline,
  getCurrentApplication,
  reopenApplicationSupplement,
  startCurrentApplication,
  submitApplication,
  updateApplicationTargetLevel,
} from './applications.controller';
import {
  autosaveDraftSchema,
  getCurrentApplicationQuerySchema,
  reopenSupplementSchema,
  startApplicationSchema,
  submitApplicationSchema,
  timelineQuerySchema,
  updateTargetLevelSchema,
} from './applications.validation';

export const applicationsRouter = Router();

applicationsRouter.get(
  '/current',
  requireAuth,
  requireRole(Role.student),
  validate({ query: getCurrentApplicationQuerySchema }),
  asyncHandler(getCurrentApplication),
);
applicationsRouter.post(
  '/current/start',
  requireAuth,
  requireRole(Role.student),
  validate({ body: startApplicationSchema }),
  asyncHandler(startCurrentApplication),
);
applicationsRouter.patch(
  '/:id/target-level',
  requireAuth,
  requireRole(Role.student, Role.admin),
  validate({ body: updateTargetLevelSchema }),
  asyncHandler(updateApplicationTargetLevel),
);
applicationsRouter.patch(
  '/:id/draft',
  requireAuth,
  requireRole(Role.student, Role.admin),
  validate({ body: autosaveDraftSchema }),
  asyncHandler(autosaveApplicationDraft),
);
applicationsRouter.get(
  '/:id/timeline',
  requireAuth,
  requireRole(Role.student, Role.admin),
  validate({ query: timelineQuerySchema }),
  asyncHandler(getApplicationTimeline),
);
applicationsRouter.post(
  '/:id/submit',
  requireAuth,
  requireRole(Role.student, Role.admin),
  validate({ body: submitApplicationSchema }),
  asyncHandler(submitApplication),
);
applicationsRouter.post(
  '/:id/reopen-supplement',
  requireAuth,
  requireRole(Role.manager, Role.admin),
  validate({ body: reopenSupplementSchema }),
  asyncHandler(reopenApplicationSupplement),
);

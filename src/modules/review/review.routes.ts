import { Role } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import {
  decideReviewTask,
  ensureReviewTasks,
  escalateReviewTaskResolution,
  getCriterionLevelAssessment,
  getReviewDashboard,
  getReviewTaskDetail,
  getReviewTaskTimeline,
  listReviewTasks,
  claimReviewTask,
  requestReviewTaskSupplement,
} from './review.controller';
import {
  ensureTasksSchema,
  escalateResolutionSchema,
  listReviewTasksQuerySchema,
  requestSupplementSchema,
  taskDecisionSchema,
} from './review.validation';

export const reviewRouter = Router();

reviewRouter.get(
  '/dashboard',
  requireAuth,
  requireRole(Role.officer, Role.manager, Role.committee, Role.admin),
  asyncHandler(getReviewDashboard),
);

reviewRouter.post(
  '/applications/:applicationId/tasks/ensure',
  requireAuth,
  requireRole(Role.officer, Role.manager, Role.admin),
  validate({ body: ensureTasksSchema }),
  asyncHandler(ensureReviewTasks),
);

reviewRouter.get(
  '/tasks',
  requireAuth,
  requireRole(Role.officer, Role.manager, Role.committee, Role.admin),
  validate({ query: listReviewTasksQuerySchema }),
  asyncHandler(listReviewTasks),
);
reviewRouter.get(
  '/tasks/:id',
  requireAuth,
  requireRole(Role.officer, Role.manager, Role.committee, Role.admin),
  asyncHandler(getReviewTaskDetail),
);
reviewRouter.get(
  '/tasks/:id/criterion-level-assessment',
  requireAuth,
  requireRole(Role.officer, Role.manager, Role.committee, Role.admin),
  asyncHandler(getCriterionLevelAssessment),
);
reviewRouter.get(
  '/tasks/:id/timeline',
  requireAuth,
  requireRole(Role.officer, Role.manager, Role.committee, Role.admin),
  asyncHandler(getReviewTaskTimeline),
);
reviewRouter.post(
  '/tasks/:id/claim',
  requireAuth,
  requireRole(Role.officer),
  asyncHandler(claimReviewTask),
);
reviewRouter.post(
  '/tasks/:id/decision',
  requireAuth,
  requireRole(Role.officer, Role.manager, Role.committee, Role.admin),
  validate({ body: taskDecisionSchema }),
  asyncHandler(decideReviewTask),
);
reviewRouter.post(
  '/tasks/:id/request-supplement',
  requireAuth,
  requireRole(Role.officer, Role.manager, Role.committee, Role.admin),
  validate({ body: requestSupplementSchema }),
  asyncHandler(requestReviewTaskSupplement),
);
reviewRouter.post(
  '/tasks/:id/escalate-resolution',
  requireAuth,
  requireRole(Role.officer, Role.manager, Role.committee, Role.admin),
  validate({ body: escalateResolutionSchema }),
  asyncHandler(escalateReviewTaskResolution),
);

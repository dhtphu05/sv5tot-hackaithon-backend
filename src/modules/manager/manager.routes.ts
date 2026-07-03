import { Role } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import {
  finalizeCollective,
  getCollectiveAggregation,
  listManagerCollectives,
} from '../collective/collective.controller';
import {
  finalizeCollectiveSchema,
  listManagerCollectivesQuerySchema,
} from '../collective/collective.validation';
import {
  aggregateApplication,
  assignManagerReviewTask,
  finalizeApplication,
  getApplicationAggregation,
  getApplicationSummary,
  getManagerDashboardSummary,
  getManagerResultDetail,
  getManagerWorkloads,
  listManagerResults,
  listManagerApplications,
  reopenFinalApplication,
} from './manager.controller';
import {
  aggregateApplicationSchema,
  assignReviewTaskSchema,
  finalizeApplicationSchema,
  listManagerApplicationsQuerySchema,
  listManagerResultsQuerySchema,
  reopenFinalSchema,
} from './manager.validation';

export const managerRouter = Router();

managerRouter.get(
  '/collective-profiles',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.admin),
  validate({ query: listManagerCollectivesQuerySchema }),
  asyncHandler(listManagerCollectives),
);
managerRouter.get(
  '/collective-profiles/:id/aggregation',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.admin),
  asyncHandler(getCollectiveAggregation),
);
managerRouter.post(
  '/collective-profiles/:id/finalize',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.admin),
  validate({ body: finalizeCollectiveSchema }),
  asyncHandler(finalizeCollective),
);

managerRouter.get(
  '/applications',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.admin),
  validate({ query: listManagerApplicationsQuerySchema }),
  asyncHandler(listManagerApplications),
);
managerRouter.get(
  '/workload',
  requireAuth,
  requireRole(Role.manager, Role.admin),
  asyncHandler(getManagerWorkloads),
);
managerRouter.get(
  '/workloads',
  requireAuth,
  requireRole(Role.manager, Role.admin),
  asyncHandler(getManagerWorkloads),
);
managerRouter.get(
  '/dashboard-summary',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.admin),
  asyncHandler(getManagerDashboardSummary),
);
managerRouter.get(
  '/results',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.admin),
  validate({ query: listManagerResultsQuerySchema }),
  asyncHandler(listManagerResults),
);
managerRouter.get(
  '/results/:applicationId',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.admin),
  asyncHandler(getManagerResultDetail),
);
managerRouter.post(
  '/review-tasks/:id/assign',
  requireAuth,
  requireRole(Role.manager, Role.admin),
  validate({ body: assignReviewTaskSchema }),
  asyncHandler(assignManagerReviewTask),
);
managerRouter.patch(
  '/review-tasks/:id/reassign',
  requireAuth,
  requireRole(Role.manager, Role.admin),
  validate({ body: assignReviewTaskSchema }),
  asyncHandler(assignManagerReviewTask),
);
managerRouter.get(
  '/applications/:id/summary',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.admin),
  asyncHandler(getApplicationSummary),
);
managerRouter.get(
  '/applications/:id/aggregation',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.admin),
  asyncHandler(getApplicationAggregation),
);
managerRouter.post(
  '/applications/:id/aggregate',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.admin),
  validate({ body: aggregateApplicationSchema }),
  asyncHandler(aggregateApplication),
);
managerRouter.post(
  '/applications/:id/finalize',
  requireAuth,
  requireRole(Role.committee, Role.admin),
  validate({ body: finalizeApplicationSchema }),
  asyncHandler(finalizeApplication),
);
managerRouter.post(
  '/applications/:id/reopen-final',
  requireAuth,
  requireRole(Role.committee, Role.admin),
  validate({ body: reopenFinalSchema }),
  asyncHandler(reopenFinalApplication),
);

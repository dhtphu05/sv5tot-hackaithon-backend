import { Role } from '@prisma/client';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import {
  finalizeCollective,
  getCollectiveDetail,
  getCollectiveAggregation,
  listManagerCollectives,
} from '../collective/collective.controller';
import {
  finalizeCollectiveSchema,
  listManagerCollectivesQuerySchema,
} from '../collective/collective.validation';
import {
  aggregateApplication,
  createCityReviewSeason,
  getCityReviewSeason,
  getManagerSubmissionDeadline,
  assignManagerReviewTask,
  finalizeApplication,
  getApplicationAggregation,
  getApplicationSummary,
  getEligibilityVerificationDetail,
  getCommitteeInbox,
  getManagerDashboardSummary,
  getManagerResultDetail,
  getManagerWorkloads,
  listManagerResults,
  listManagerApplications,
  reopenFinalApplication,
  grantSubmissionWindowException,
  revokeSubmissionWindowException,
  updateCityReviewSeason,
} from './manager.controller';
import {
  aggregateApplicationSchema,
  assignReviewTaskSchema,
  committeeInboxQuerySchema,
  finalizeApplicationSchema,
  listManagerApplicationsQuerySchema,
  listManagerResultsQuerySchema,
  reopenFinalSchema,
  cityReviewSeasonCreateSchema,
  cityReviewSeasonParamsSchema,
  cityReviewSeasonUpdateSchema,
  revokeSubmissionWindowExceptionSchema,
  submissionWindowExceptionSchema,
} from './manager.validation';

export const managerRouter = Router();

managerRouter.get(
  '/city-review-seasons/:schoolYear',
  requireAuth,
  requireRole(Role.city_manager, Role.admin),
  validate({ params: cityReviewSeasonParamsSchema }),
  asyncHandler(getCityReviewSeason),
);
managerRouter.post(
  '/city-review-seasons',
  requireAuth,
  requireRole(Role.city_manager, Role.admin),
  validate({ body: cityReviewSeasonCreateSchema }),
  asyncHandler(createCityReviewSeason),
);
managerRouter.patch(
  '/city-review-seasons/:schoolYear',
  requireAuth,
  requireRole(Role.city_manager, Role.admin),
  validate({ params: cityReviewSeasonParamsSchema, body: cityReviewSeasonUpdateSchema }),
  asyncHandler(updateCityReviewSeason),
);
managerRouter.get(
  '/applications/:id/submission-deadline',
  requireAuth,
  requireRole(Role.city_manager, Role.admin),
  asyncHandler(getManagerSubmissionDeadline),
);
managerRouter.put(
  '/applications/:id/submission-deadline-exception',
  requireAuth,
  requireRole(Role.city_manager, Role.admin),
  validate({ body: submissionWindowExceptionSchema }),
  asyncHandler(grantSubmissionWindowException),
);
managerRouter.delete(
  '/applications/:id/submission-deadline-exception',
  requireAuth,
  requireRole(Role.city_manager, Role.admin),
  validate({ body: revokeSubmissionWindowExceptionSchema }),
  asyncHandler(revokeSubmissionWindowException),
);

function requireCityManagerForPendingEligibility(req: Request, _res: Response, next: NextFunction) {
  if (req.query.eligibilityVerification && req.user?.role !== Role.city_manager) {
    next(
      new AppError(
        403,
        ErrorCodes.FORBIDDEN,
        'Only a City Manager can list eligibility verification cases',
      ),
    );
    return;
  }
  next();
}

managerRouter.get(
  '/collective-profiles',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.city_manager, Role.city_committee, Role.admin),
  validate({ query: listManagerCollectivesQuerySchema }),
  asyncHandler(listManagerCollectives),
);
managerRouter.get(
  '/collective-profiles/:id',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.city_manager, Role.city_committee, Role.admin),
  asyncHandler(getCollectiveDetail),
);
managerRouter.get(
  '/collective-profiles/:id/aggregation',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.city_manager, Role.city_committee, Role.admin),
  asyncHandler(getCollectiveAggregation),
);
managerRouter.post(
  '/collective-profiles/:id/finalize',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.city_committee, Role.admin),
  validate({ body: finalizeCollectiveSchema }),
  asyncHandler(finalizeCollective),
);

managerRouter.get(
  '/applications',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.city_manager, Role.city_committee, Role.admin),
  validate({ query: listManagerApplicationsQuerySchema }),
  requireCityManagerForPendingEligibility,
  asyncHandler(listManagerApplications),
);
managerRouter.get(
  '/workload',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.city_manager, Role.admin),
  asyncHandler(getManagerWorkloads),
);
managerRouter.get(
  '/workloads',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.city_manager, Role.admin),
  asyncHandler(getManagerWorkloads),
);
managerRouter.get(
  '/dashboard-summary',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.city_manager, Role.admin),
  asyncHandler(getManagerDashboardSummary),
);
managerRouter.get(
  '/committee-inbox',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.city_manager, Role.city_committee, Role.admin),
  validate({ query: committeeInboxQuerySchema }),
  asyncHandler(getCommitteeInbox),
);
managerRouter.get(
  '/results',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.city_manager, Role.city_committee, Role.admin),
  validate({ query: listManagerResultsQuerySchema }),
  asyncHandler(listManagerResults),
);
managerRouter.get(
  '/results/:applicationId',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.city_manager, Role.city_committee, Role.admin),
  asyncHandler(getManagerResultDetail),
);
managerRouter.post(
  '/review-tasks/:id/assign',
  requireAuth,
  requireRole(Role.manager, Role.city_manager, Role.admin),
  validate({ body: assignReviewTaskSchema }),
  asyncHandler(assignManagerReviewTask),
);
managerRouter.patch(
  '/review-tasks/:id/reassign',
  requireAuth,
  requireRole(Role.manager, Role.city_manager, Role.admin),
  validate({ body: assignReviewTaskSchema }),
  asyncHandler(assignManagerReviewTask),
);
managerRouter.get(
  '/applications/:id/eligibility-verification',
  requireAuth,
  requireRole(Role.city_manager),
  asyncHandler(getEligibilityVerificationDetail),
);
managerRouter.get(
  '/applications/:id/summary',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.city_manager, Role.city_committee, Role.admin),
  asyncHandler(getApplicationSummary),
);
managerRouter.get(
  '/applications/:id/aggregation',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.city_manager, Role.city_committee, Role.admin),
  asyncHandler(getApplicationAggregation),
);
managerRouter.post(
  '/applications/:id/aggregate',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.city_manager, Role.city_committee, Role.admin),
  validate({ body: aggregateApplicationSchema }),
  asyncHandler(aggregateApplication),
);
managerRouter.post(
  '/applications/:id/finalize',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.city_manager, Role.city_committee, Role.admin),
  validate({ body: finalizeApplicationSchema }),
  asyncHandler(finalizeApplication),
);
managerRouter.post(
  '/applications/:id/reopen-final',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.city_manager, Role.city_committee, Role.admin),
  validate({ body: reopenFinalSchema }),
  asyncHandler(reopenFinalApplication),
);

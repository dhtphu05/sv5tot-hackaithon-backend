import { Role } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import {
  decideResolutionCase,
  getResolutionCase,
  listResolutionCases,
  reopenResolutionCase,
} from './resolution.controller';
import {
  listResolutionCasesQuerySchema,
  reopenResolutionCaseSchema,
  resolutionDecisionSchema,
} from './resolution.validation';

export const resolutionRouter = Router();

resolutionRouter.get(
  '/cases',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.admin),
  validate({ query: listResolutionCasesQuerySchema }),
  asyncHandler(listResolutionCases),
);
resolutionRouter.get(
  '/cases/:id',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.admin),
  asyncHandler(getResolutionCase),
);
resolutionRouter.post(
  '/cases/:id/decision',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.admin),
  validate({ body: resolutionDecisionSchema }),
  asyncHandler(decideResolutionCase),
);
resolutionRouter.post(
  '/cases/:id/reopen',
  requireAuth,
  requireRole(Role.committee, Role.admin),
  validate({ body: reopenResolutionCaseSchema }),
  asyncHandler(reopenResolutionCase),
);

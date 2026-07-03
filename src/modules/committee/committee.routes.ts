import { Role } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import { getCommitteeInbox } from '../manager/manager.controller';
import { committeeInboxQuerySchema } from '../manager/manager.validation';

export const committeeRouter = Router();

committeeRouter.get(
  '/inbox',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.admin),
  validate({ query: committeeInboxQuerySchema }),
  asyncHandler(getCommitteeInbox),
);

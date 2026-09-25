import { Role } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import { getActiveCriteriaConfigs } from './criteria.controller';
import { activeCriteriaQuerySchema } from './criteria.validation';

export const criteriaRouter = Router();

criteriaRouter.get(
  '/configs/active',
  requireAuth,
  requireRole(Role.student, Role.class_representative, Role.officer, Role.manager, Role.committee, Role.admin),
  validate({ query: activeCriteriaQuerySchema }),
  asyncHandler(getActiveCriteriaConfigs),
);

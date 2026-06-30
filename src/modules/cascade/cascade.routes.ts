import { Role } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import {
  getLatestApplicationCascadeReview,
  runApplicationCascadeReview,
} from './cascade.controller';
import { runCascadeReviewSchema } from './cascade.validation';

export const cascadeRouter = Router();

cascadeRouter.post(
  '/applications/:id/cascade-review',
  requireAuth,
  requireRole(
    Role.student,
    Role.class_representative,
    Role.officer,
    Role.manager,
    Role.committee,
    Role.admin,
  ),
  validate({ body: runCascadeReviewSchema }),
  asyncHandler(runApplicationCascadeReview),
);
cascadeRouter.get(
  '/applications/:id/cascade-review/latest',
  requireAuth,
  requireRole(
    Role.student,
    Role.class_representative,
    Role.officer,
    Role.manager,
    Role.committee,
    Role.admin,
  ),
  asyncHandler(getLatestApplicationCascadeReview),
);

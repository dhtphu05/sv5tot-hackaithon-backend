import { Role } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import { getJob, runJob } from './jobs.controller';

export const jobsRouter = Router();

jobsRouter.get(
  '/:id',
  requireAuth,
  requireRole(Role.student, Role.class_representative, Role.officer, Role.manager, Role.admin),
  asyncHandler(getJob),
);
jobsRouter.post(
  '/:id/run',
  requireAuth,
  requireRole(Role.manager, Role.admin),
  asyncHandler(runJob),
);

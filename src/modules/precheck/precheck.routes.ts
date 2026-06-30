import { Role } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import { getLatestApplicationPrecheck, runApplicationPrecheck } from './precheck.controller';
import { runPrecheckSchema } from './precheck.validation';

export const precheckRouter = Router();

precheckRouter.post(
  '/applications/:id/precheck',
  requireAuth,
  requireRole(Role.student, Role.class_representative, Role.officer, Role.manager, Role.admin),
  validate({ body: runPrecheckSchema }),
  asyncHandler(runApplicationPrecheck),
);
precheckRouter.get(
  '/applications/:id/precheck/latest',
  requireAuth,
  requireRole(
    Role.student,
    Role.class_representative,
    Role.officer,
    Role.manager,
    Role.committee,
    Role.admin,
  ),
  asyncHandler(getLatestApplicationPrecheck),
);

import { Role } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { env } from '../../config/env';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import { getJob, retryJob, runJob, runWorkerTick } from './jobs.controller';

export const jobsRouter = Router();

jobsRouter.post('/worker/tick', requireWorkerAccess, asyncHandler(runWorkerTick));
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
jobsRouter.post(
  '/:id/retry',
  requireAuth,
  requireRole(Role.student, Role.class_representative, Role.officer, Role.manager, Role.admin),
  asyncHandler(retryJob),
);

function requireWorkerAccess(req: Request, res: Response, next: NextFunction): void {
  const token = req.header('x-internal-worker-token');
  if (env.INTERNAL_WORKER_TOKEN && token === env.INTERNAL_WORKER_TOKEN) {
    next();
    return;
  }

  void requireAuth(req, res, (authError?: unknown) => {
    if (authError) {
      next(authError);
      return;
    }
    requireRole(Role.manager, Role.admin)(req, res, next);
  });
}

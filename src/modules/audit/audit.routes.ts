import { Role } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import { auditPlaceholder } from './audit.controller';

export const auditRouter = Router();

auditRouter.get(
  '/logs',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.admin),
  asyncHandler(auditPlaceholder),
);

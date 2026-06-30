import { Role } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import { smartUxPlaceholder } from './smartux.controller';

export const smartUxRouter = Router();

smartUxRouter.post(
  '/events',
  requireAuth,
  requireRole(
    Role.student,
    Role.class_representative,
    Role.officer,
    Role.manager,
    Role.committee,
    Role.admin,
  ),
  asyncHandler(smartUxPlaceholder),
);
smartUxRouter.get(
  '/dashboard',
  requireAuth,
  requireRole(Role.manager, Role.admin),
  asyncHandler(smartUxPlaceholder),
);

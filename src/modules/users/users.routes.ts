import { Role } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { uploadMiddleware } from '../../middlewares/upload.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import { getMe, listUsers, updateMe, uploadAvatar } from './users.controller';
import { listUsersQuerySchema, updateMeSchema } from './users.validation';

export const meRouter = Router();
export const usersRouter = Router();

meRouter.get('/', requireAuth, asyncHandler(getMe));
meRouter.patch('/', requireAuth, validate({ body: updateMeSchema }), asyncHandler(updateMe));
meRouter.post('/avatar', requireAuth, uploadMiddleware.single('file'), asyncHandler(uploadAvatar));

usersRouter.get(
  '/',
  requireAuth,
  requireRole(Role.manager, Role.admin, Role.committee),
  validate({ query: listUsersQuerySchema }),
  asyncHandler(listUsers),
);

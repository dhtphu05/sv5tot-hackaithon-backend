import { Role } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { uploadMiddleware } from '../../middlewares/upload.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import {
  createAdminUser,
  getAdminUser,
  getMe,
  listAdminUsers,
  listUsers,
  resetAdminUserPassword,
  updateAdminUser,
  updateAdminUserStatus,
  updateCityOfficerSpecializations,
  updateMe,
  uploadAvatar,
} from './users.controller';
import {
  adminUserIdParamSchema,
  cityOfficerSpecializationsSchema,
  createAdminUserSchema,
  listAdminUsersQuerySchema,
  listUsersQuerySchema,
  adminUserStatusSchema,
  adminUserResetPasswordSchema,
  updateAdminUserSchema,
  updateMeSchema,
} from './users.validation';

export const meRouter = Router();
export const usersRouter = Router();
export const adminUsersRouter = Router();

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

adminUsersRouter.use(requireAuth, requireRole(Role.admin));
adminUsersRouter.get('/', validate({ query: listAdminUsersQuerySchema }), asyncHandler(listAdminUsers));
adminUsersRouter.post('/', validate({ body: createAdminUserSchema }), asyncHandler(createAdminUser));
adminUsersRouter.get('/:userId', validate({ params: adminUserIdParamSchema }), asyncHandler(getAdminUser));
adminUsersRouter.patch(
  '/:userId',
  validate({ params: adminUserIdParamSchema, body: updateAdminUserSchema }),
  asyncHandler(updateAdminUser),
);
adminUsersRouter.patch(
  '/:userId/status',
  validate({ params: adminUserIdParamSchema, body: adminUserStatusSchema }),
  asyncHandler(updateAdminUserStatus),
);
adminUsersRouter.post(
  '/:userId/reset-password',
  validate({ params: adminUserIdParamSchema, body: adminUserResetPasswordSchema }),
  asyncHandler(resetAdminUserPassword),
);
adminUsersRouter.put(
  '/:userId/specializations',
  validate({ params: adminUserIdParamSchema, body: cityOfficerSpecializationsSchema }),
  asyncHandler(updateCityOfficerSpecializations),
);

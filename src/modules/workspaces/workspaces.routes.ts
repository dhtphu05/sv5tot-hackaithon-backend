import { Role } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import {
  createAdminWorkspace,
  getAdminWorkspace,
  listAdminWorkspaceUsers,
  listAdminWorkspaces,
  listWorkspaces,
  updateAdminWorkspace,
  updateAdminWorkspaceStatus,
} from './workspaces.controller';
import {
  createAdminWorkspaceBodySchema,
  listAdminWorkspacesQuerySchema,
  listAdminWorkspaceUsersQuerySchema,
  listWorkspacesQuerySchema,
  updateAdminWorkspaceBodySchema,
  updateAdminWorkspaceStatusBodySchema,
  workspaceIdParamSchema,
} from './workspaces.validation';

export const workspacesRouter = Router();
export const adminWorkspacesRouter = Router();

workspacesRouter.get(
  '/',
  validate({ query: listWorkspacesQuerySchema }),
  asyncHandler(listWorkspaces),
);

adminWorkspacesRouter.use(requireAuth, requireRole(Role.admin));

adminWorkspacesRouter.get(
  '/',
  validate({ query: listAdminWorkspacesQuerySchema }),
  asyncHandler(listAdminWorkspaces),
);

adminWorkspacesRouter.post(
  '/',
  validate({ body: createAdminWorkspaceBodySchema }),
  asyncHandler(createAdminWorkspace),
);

adminWorkspacesRouter.get(
  '/:workspaceId',
  validate({ params: workspaceIdParamSchema }),
  asyncHandler(getAdminWorkspace),
);

adminWorkspacesRouter.patch(
  '/:workspaceId',
  validate({ params: workspaceIdParamSchema, body: updateAdminWorkspaceBodySchema }),
  asyncHandler(updateAdminWorkspace),
);

adminWorkspacesRouter.patch(
  '/:workspaceId/status',
  validate({ params: workspaceIdParamSchema, body: updateAdminWorkspaceStatusBodySchema }),
  asyncHandler(updateAdminWorkspaceStatus),
);

adminWorkspacesRouter.get(
  '/:workspaceId/users',
  validate({ params: workspaceIdParamSchema, query: listAdminWorkspaceUsersQuerySchema }),
  asyncHandler(listAdminWorkspaceUsers),
);

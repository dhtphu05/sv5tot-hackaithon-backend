import { Role } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import { getFileMetadata, getSignedFileUrl, downloadLocalFile } from './files.controller';

export const filesRouter = Router();

filesRouter.get(
  '/files/download',
  asyncHandler(downloadLocalFile),
);

filesRouter.get(
  '/files/:id/signed-url',
  requireAuth,
  requireRole(
    Role.student,
    Role.class_representative,
    Role.officer,
    Role.manager,
    Role.committee,
    Role.admin,
  ),
  asyncHandler(getSignedFileUrl),
);

filesRouter.get(
  '/files/:id',
  requireAuth,
  requireRole(
    Role.student,
    Role.class_representative,
    Role.officer,
    Role.manager,
    Role.committee,
    Role.admin,
  ),
  asyncHandler(getFileMetadata),
);

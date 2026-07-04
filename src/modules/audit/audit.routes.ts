import { Role } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import { listAuditLogs } from './audit.controller';
import { listAuditLogsQuerySchema } from './audit.validation';

export const auditRouter = Router();

auditRouter.get(
  '/logs',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.admin),
  validate({ query: listAuditLogsQuerySchema }),
  asyncHandler(listAuditLogs),
);

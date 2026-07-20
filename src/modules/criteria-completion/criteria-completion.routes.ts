import { Role } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import {
  deleteRequirementResponse,
  updateRequirementResponse,
} from './criteria-completion.controller';
import { updateRequirementResponseSchema } from './criteria-completion.validation';

export const requirementResponsesRouter = Router();

requirementResponsesRouter.patch(
  '/requirement-responses/:id',
  requireAuth,
  requireRole(Role.student, Role.manager, Role.admin),
  validate({ body: updateRequirementResponseSchema }),
  asyncHandler(updateRequirementResponse),
);

requirementResponsesRouter.delete(
  '/requirement-responses/:id',
  requireAuth,
  requireRole(Role.student, Role.manager, Role.admin),
  asyncHandler(deleteRequirementResponse),
);

import { Role } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import {
  getStudentAssistantContext,
  resubmitSupplement,
  streamStudentAssistantAnswer,
} from './student-assistant.controller';
import {
  studentAssistantContextQuerySchema,
  studentAssistantStreamSchema,
  supplementResubmitSchema,
} from './student-assistant.validation';

export const studentAssistantRouter = Router();

studentAssistantRouter.get(
  '/context',
  requireAuth,
  requireRole(Role.student),
  validate({ query: studentAssistantContextQuerySchema }),
  asyncHandler(getStudentAssistantContext),
);

studentAssistantRouter.post(
  '/stream',
  requireAuth,
  requireRole(Role.student),
  validate({ body: studentAssistantStreamSchema }),
  asyncHandler(streamStudentAssistantAnswer),
);

studentAssistantRouter.post(
  '/supplements/:reviewTaskId/resubmit',
  requireAuth,
  requireRole(Role.student),
  validate({ body: supplementResubmitSchema }),
  asyncHandler(resubmitSupplement),
);

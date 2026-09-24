import { Role } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { uploadMiddleware } from '../../middlewares/upload.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import {
  createAwardDecision,
  confirmAwardDecision,
  getAwardDecisionRecipients,
  getAwardDecision,
  getAwardRosterPreview,
  getAwardRosterProcessing,
  listAwardDecisions,
  processAwardRoster,
  updateAwardRosterMapping,
  updateAwardDecision,
  uploadAwardDecisionFile,
} from './award-decisions.controller';
import {
  createAwardDecisionSchema,
  awardRosterMappingSchema,
  awardRosterPageQuerySchema,
  listAwardDecisionsQuerySchema,
  updateAwardDecisionSchema,
} from './award-decisions.validation';

export const awardDecisionsRouter = Router();

awardDecisionsRouter.use(requireAuth, requireRole(Role.data_uploader, Role.admin));

awardDecisionsRouter.get(
  '/',
  validate({ query: listAwardDecisionsQuerySchema }),
  asyncHandler(listAwardDecisions),
);
awardDecisionsRouter.post(
  '/',
  validate({ body: createAwardDecisionSchema }),
  asyncHandler(createAwardDecision),
);
awardDecisionsRouter.post('/:id/process-roster', asyncHandler(processAwardRoster));
awardDecisionsRouter.get('/:id/roster-processing', asyncHandler(getAwardRosterProcessing));
awardDecisionsRouter.get(
  '/:id/roster-preview',
  validate({ query: awardRosterPageQuerySchema }),
  asyncHandler(getAwardRosterPreview),
);
awardDecisionsRouter.patch(
  '/:id/roster-mapping',
  validate({ body: awardRosterMappingSchema }),
  asyncHandler(updateAwardRosterMapping),
);
awardDecisionsRouter.post('/:id/confirm', asyncHandler(confirmAwardDecision));
awardDecisionsRouter.get(
  '/:id/recipients',
  validate({ query: awardRosterPageQuerySchema }),
  asyncHandler(getAwardDecisionRecipients),
);
awardDecisionsRouter.get('/:id', asyncHandler(getAwardDecision));
awardDecisionsRouter.patch(
  '/:id',
  validate({ body: updateAwardDecisionSchema }),
  asyncHandler(updateAwardDecision),
);
awardDecisionsRouter.post(
  '/:id/files/:kind',
  uploadMiddleware.single('file'),
  asyncHandler(uploadAwardDecisionFile),
);

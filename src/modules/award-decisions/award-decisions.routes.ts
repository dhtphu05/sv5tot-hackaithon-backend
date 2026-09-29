import { Role } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { uploadMiddleware } from '../../middlewares/upload.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import {
  createAwardDecision,
  archiveAwardDecision,
  confirmAwardDecision,
  getAwardDecisionRecipients,
  getAwardDecision,
  getAwardRosterPreview,
  getAwardRosterProcessing,
  listAwardDecisions,
  processAwardRoster,
  updateAwardRosterMapping,
  updateAwardRosterRow,
  revertAwardRosterRowCorrection,
  updateAwardDecision,
  unarchiveAwardDecision,
  uploadAwardDecisionFile,
} from './award-decisions.controller';
import {
  createAwardDecisionSchema,
  awardRosterMappingSchema,
  awardRosterPageQuerySchema,
  awardRosterRowCorrectionSchema,
  awardRosterRowParamSchema,
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
awardDecisionsRouter.patch(
  '/:id/roster-preview/:sourceRow',
  validate({ params: awardRosterRowParamSchema, body: awardRosterRowCorrectionSchema }),
  asyncHandler(updateAwardRosterRow),
);
awardDecisionsRouter.delete(
  '/:id/roster-preview/:sourceRow/correction',
  validate({ params: awardRosterRowParamSchema }),
  asyncHandler(revertAwardRosterRowCorrection),
);
awardDecisionsRouter.post('/:id/confirm', asyncHandler(confirmAwardDecision));
awardDecisionsRouter.post('/:id/archive', asyncHandler(archiveAwardDecision));
awardDecisionsRouter.post('/:id/unarchive', asyncHandler(unarchiveAwardDecision));
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

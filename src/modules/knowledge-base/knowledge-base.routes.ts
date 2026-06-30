import { Role } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import {
  createKnowledgeBaseFromEvidence,
  getKnowledgeBaseItem,
  searchKnowledgeBase,
  updateKnowledgeBaseItem,
  useKnowledgeBaseItem,
} from './knowledge-base.controller';
import {
  createFromReviewedEvidenceSchema,
  knowledgeBaseSearchQuerySchema,
  updateKnowledgeBaseItemSchema,
} from './knowledge-base.validation';

export const knowledgeBaseRouter = Router();

knowledgeBaseRouter.get(
  '/search',
  requireAuth,
  requireRole(
    Role.student,
    Role.class_representative,
    Role.officer,
    Role.manager,
    Role.committee,
    Role.admin,
  ),
  validate({ query: knowledgeBaseSearchQuerySchema }),
  asyncHandler(searchKnowledgeBase),
);
knowledgeBaseRouter.get(
  '/:id',
  requireAuth,
  requireRole(
    Role.student,
    Role.class_representative,
    Role.officer,
    Role.manager,
    Role.committee,
    Role.admin,
  ),
  asyncHandler(getKnowledgeBaseItem),
);
knowledgeBaseRouter.post(
  '/from-reviewed-evidence',
  requireAuth,
  requireRole(Role.officer, Role.manager, Role.committee, Role.admin),
  validate({ body: createFromReviewedEvidenceSchema }),
  asyncHandler(createKnowledgeBaseFromEvidence),
);
knowledgeBaseRouter.patch(
  '/:id',
  requireAuth,
  requireRole(Role.manager, Role.committee, Role.admin),
  validate({ body: updateKnowledgeBaseItemSchema }),
  asyncHandler(updateKnowledgeBaseItem),
);
knowledgeBaseRouter.post(
  '/:id/use',
  requireAuth,
  requireRole(
    Role.student,
    Role.class_representative,
    Role.officer,
    Role.manager,
    Role.committee,
    Role.admin,
  ),
  asyncHandler(useKnowledgeBaseItem),
);

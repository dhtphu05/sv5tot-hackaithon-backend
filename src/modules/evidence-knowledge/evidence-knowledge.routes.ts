import { Role } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import {
  getOfficerEvidenceKnowledgeEvent,
  searchOfficerEvidenceKnowledge,
} from './evidence-knowledge.controller';
import {
  evidenceKnowledgeEventParamsSchema,
  evidenceKnowledgeOfficerSearchQuerySchema,
} from './evidence-knowledge.validation';

export const evidenceKnowledgeRouter = Router();

evidenceKnowledgeRouter.get(
  '/officer/search',
  requireAuth,
  requireRole(Role.officer, Role.manager, Role.committee, Role.admin),
  validate({ query: evidenceKnowledgeOfficerSearchQuerySchema }),
  asyncHandler(searchOfficerEvidenceKnowledge),
);

evidenceKnowledgeRouter.get(
  '/officer/events/:eventId',
  requireAuth,
  requireRole(Role.officer, Role.manager, Role.committee, Role.admin),
  validate({ params: evidenceKnowledgeEventParamsSchema }),
  asyncHandler(getOfficerEvidenceKnowledgeEvent),
);

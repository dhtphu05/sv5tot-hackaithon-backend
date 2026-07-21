import { Role } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import {
  importEvidenceMatching,
  listOfficialEvidenceLibrary,
  searchEvidenceMatching,
  suggestEvidenceEvents,
} from './evidence-matching.controller';
import {
  evidenceEventSuggestionQuerySchema,
  evidenceMatchingLibraryQuerySchema,
  evidenceMatchingSearchQuerySchema,
  importEvidenceMatchingSchema,
} from './evidence-matching.validation';

export const evidenceMatchingRouter = Router();

evidenceMatchingRouter.get(
  '/library',
  requireAuth,
  requireRole(Role.student),
  validate({ query: evidenceMatchingLibraryQuerySchema }),
  asyncHandler(listOfficialEvidenceLibrary),
);

evidenceMatchingRouter.get(
  '/suggestions',
  requireAuth,
  requireRole(Role.student, Role.class_representative),
  validate({ query: evidenceEventSuggestionQuerySchema }),
  asyncHandler(suggestEvidenceEvents),
);

evidenceMatchingRouter.get(
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
  validate({ query: evidenceMatchingSearchQuerySchema }),
  asyncHandler(searchEvidenceMatching),
);

evidenceMatchingRouter.post(
  '/:eventId/import',
  requireAuth,
  requireRole(Role.student, Role.class_representative, Role.officer, Role.manager, Role.admin),
  validate({ body: importEvidenceMatchingSchema }),
  asyncHandler(importEvidenceMatching),
);

import { Role } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { uploadMiddleware } from '../../middlewares/upload.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import {
  createApplicationEvidence,
  deleteEvidence,
  getEvidenceCard,
  listApplicationEvidences,
  startEvidenceIndexing,
  updateEvidence,
  uploadEvidenceFile,
} from './evidences.controller';
import {
  createEvidenceSchema,
  listEvidencesQuerySchema,
  startIndexingSchema,
  updateEvidenceSchema,
} from './evidences.validation';

export const evidencesRouter = Router();

evidencesRouter.get(
  '/applications/:applicationId/evidences',
  requireAuth,
  requireRole(
    Role.student,
    Role.class_representative,
    Role.officer,
    Role.manager,
    Role.committee,
    Role.admin,
  ),
  validate({ query: listEvidencesQuerySchema }),
  asyncHandler(listApplicationEvidences),
);
evidencesRouter.post(
  '/applications/:applicationId/evidences',
  requireAuth,
  requireRole(Role.student, Role.class_representative, Role.officer, Role.manager, Role.admin),
  validate({ body: createEvidenceSchema }),
  asyncHandler(createApplicationEvidence),
);
evidencesRouter.post(
  '/evidences/:id/files',
  requireAuth,
  requireRole(Role.student, Role.class_representative, Role.officer, Role.manager, Role.admin),
  uploadMiddleware.single('file'),
  asyncHandler(uploadEvidenceFile),
);
evidencesRouter.post(
  '/evidences/:id/start-indexing',
  requireAuth,
  requireRole(Role.student, Role.class_representative, Role.officer, Role.manager, Role.admin),
  validate({ body: startIndexingSchema }),
  asyncHandler(startEvidenceIndexing),
);
evidencesRouter.get(
  '/evidences/:id/card',
  requireAuth,
  requireRole(
    Role.student,
    Role.class_representative,
    Role.officer,
    Role.manager,
    Role.committee,
    Role.admin,
  ),
  asyncHandler(getEvidenceCard),
);
evidencesRouter.patch(
  '/evidences/:id',
  requireAuth,
  requireRole(Role.student, Role.class_representative, Role.admin),
  validate({ body: updateEvidenceSchema }),
  asyncHandler(updateEvidence),
);
evidencesRouter.delete(
  '/evidences/:id',
  requireAuth,
  requireRole(Role.student, Role.class_representative, Role.admin),
  asyncHandler(deleteEvidence),
);

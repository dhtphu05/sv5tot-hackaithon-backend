import { Role } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { uploadMiddleware } from '../../middlewares/upload.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import {
  createCollectiveEvidence,
  deleteCollectiveMember,
  getCollectiveDetail,
  getCurrentCollective,
  getLatestCollectivePrecheck,
  importCollectiveEvent,
  importCollectiveRoster,
  listCollectiveEvidences,
  listCollectiveMembers,
  runCollectivePrecheck,
  startCollectiveEvidenceIndexing,
  startCurrentCollective,
  submitCollective,
  updateCollective,
  updateCollectiveMember,
  uploadCollectiveEvidenceFile,
  upsertCollectiveMember,
} from './collective.controller';
import {
  collectivePrecheckSchema,
  collectiveSubmitSchema,
  createCollectiveEvidenceSchema,
  getCurrentCollectiveQuerySchema,
  importCollectiveEventSchema,
  listCollectiveEvidencesQuerySchema,
  listCollectiveMembersQuerySchema,
  startCollectiveIndexingSchema,
  startCollectiveProfileSchema,
  updateCollectiveMemberSchema,
  updateCollectiveProfileSchema,
  upsertCollectiveMemberSchema,
} from './collective.validation';

export const collectiveRouter = Router();
const viewers = [Role.class_representative, Role.manager, Role.admin];

collectiveRouter.get(
  '/current',
  requireAuth,
  requireRole(Role.class_representative, Role.admin),
  validate({ query: getCurrentCollectiveQuerySchema }),
  asyncHandler(getCurrentCollective),
);
collectiveRouter.post(
  '/current/start',
  requireAuth,
  requireRole(Role.class_representative, Role.admin),
  validate({ body: startCollectiveProfileSchema }),
  asyncHandler(startCurrentCollective),
);
collectiveRouter.get(
  '/:id/members',
  requireAuth,
  requireRole(...viewers),
  validate({ query: listCollectiveMembersQuerySchema }),
  asyncHandler(listCollectiveMembers),
);
collectiveRouter.post(
  '/:id/members',
  requireAuth,
  requireRole(Role.class_representative, Role.admin),
  validate({ body: upsertCollectiveMemberSchema }),
  asyncHandler(upsertCollectiveMember),
);
collectiveRouter.post(
  '/:id/members/import',
  requireAuth,
  requireRole(Role.class_representative, Role.manager, Role.admin),
  uploadMiddleware.single('file'),
  asyncHandler(importCollectiveRoster),
);
collectiveRouter.patch(
  '/:id/members/:memberId',
  requireAuth,
  requireRole(Role.class_representative, Role.manager, Role.admin),
  validate({ body: updateCollectiveMemberSchema }),
  asyncHandler(updateCollectiveMember),
);
collectiveRouter.delete(
  '/:id/members/:memberId',
  requireAuth,
  requireRole(Role.class_representative, Role.admin),
  asyncHandler(deleteCollectiveMember),
);
collectiveRouter.get(
  '/:id/evidences',
  requireAuth,
  requireRole(...viewers),
  validate({ query: listCollectiveEvidencesQuerySchema }),
  asyncHandler(listCollectiveEvidences),
);
collectiveRouter.post(
  '/:id/evidences',
  requireAuth,
  requireRole(Role.class_representative, Role.admin),
  validate({ body: createCollectiveEvidenceSchema }),
  asyncHandler(createCollectiveEvidence),
);
collectiveRouter.post(
  '/evidences/:evidenceId/files',
  requireAuth,
  requireRole(Role.class_representative, Role.admin),
  uploadMiddleware.single('file'),
  asyncHandler(uploadCollectiveEvidenceFile),
);
collectiveRouter.post(
  '/evidences/:evidenceId/start-indexing',
  requireAuth,
  requireRole(Role.class_representative, Role.manager, Role.admin),
  validate({ body: startCollectiveIndexingSchema }),
  asyncHandler(startCollectiveEvidenceIndexing),
);
collectiveRouter.post(
  '/:id/import-event',
  requireAuth,
  requireRole(Role.class_representative, Role.admin),
  validate({ body: importCollectiveEventSchema }),
  asyncHandler(importCollectiveEvent),
);
collectiveRouter.post(
  '/:id/precheck',
  requireAuth,
  requireRole(Role.class_representative, Role.manager, Role.admin),
  validate({ body: collectivePrecheckSchema }),
  asyncHandler(runCollectivePrecheck),
);
collectiveRouter.get(
  '/:id/precheck/latest',
  requireAuth,
  requireRole(...viewers),
  asyncHandler(getLatestCollectivePrecheck),
);
collectiveRouter.post(
  '/:id/submit',
  requireAuth,
  requireRole(Role.class_representative, Role.admin),
  validate({ body: collectiveSubmitSchema }),
  asyncHandler(submitCollective),
);
collectiveRouter.get(
  '/:id',
  requireAuth,
  requireRole(...viewers),
  asyncHandler(getCollectiveDetail),
);
collectiveRouter.patch(
  '/:id',
  requireAuth,
  requireRole(Role.class_representative, Role.manager, Role.admin),
  validate({ body: updateCollectiveProfileSchema }),
  asyncHandler(updateCollective),
);

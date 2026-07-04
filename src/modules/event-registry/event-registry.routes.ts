import { Role } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { uploadMiddleware } from '../../middlewares/upload.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import {
  checkParticipant,
  confirmIndex,
  createEvent,
  deleteEvent,
  getEvent,
  importEventAsEvidence,
  importEventToApplication,
  importParticipants,
  listEvents,
  listParticipants,
  searchEvents,
  startRosterIndexing,
  updateEvent,
  uploadRosterFile,
} from './event-registry.controller';
import {
  checkParticipantSchema,
  confirmIndexSchema,
  createEventSchema,
  importAsEvidenceSchema,
  importParticipantsJsonSchema,
  importToApplicationSchema,
  listEventsQuerySchema,
  participantsQuerySchema,
  searchEventsQuerySchema,
  startRosterIndexingSchema,
  updateEventSchema,
} from './event-registry.validation';

export const eventRegistryRouter = Router();

eventRegistryRouter.get(
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
  validate({ query: searchEventsQuerySchema }),
  asyncHandler(searchEvents),
);
eventRegistryRouter.get(
  '/',
  requireAuth,
  requireRole(
    Role.student,
    Role.class_representative,
    Role.officer,
    Role.manager,
    Role.committee,
    Role.admin,
  ),
  validate({ query: listEventsQuerySchema }),
  asyncHandler(listEvents),
);
eventRegistryRouter.post(
  '/',
  requireAuth,
  requireRole(Role.officer, Role.manager, Role.admin),
  validate({ body: createEventSchema }),
  asyncHandler(createEvent),
);
eventRegistryRouter.get(
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
  asyncHandler(getEvent),
);
eventRegistryRouter.patch(
  '/:id',
  requireAuth,
  requireRole(Role.officer, Role.manager, Role.admin),
  validate({ body: updateEventSchema }),
  asyncHandler(updateEvent),
);
eventRegistryRouter.delete(
  '/:id',
  requireAuth,
  requireRole(Role.officer, Role.manager, Role.admin),
  asyncHandler(deleteEvent),
);
eventRegistryRouter.post(
  '/:id/roster-files',
  requireAuth,
  requireRole(Role.officer, Role.manager, Role.admin),
  uploadMiddleware.single('file'),
  asyncHandler(uploadRosterFile),
);
eventRegistryRouter.post(
  '/:id/start-indexing',
  requireAuth,
  requireRole(Role.officer, Role.manager, Role.admin),
  validate({ body: startRosterIndexingSchema }),
  asyncHandler(startRosterIndexing),
);
eventRegistryRouter.get(
  '/:id/participants',
  requireAuth,
  requireRole(Role.officer, Role.manager, Role.committee, Role.admin),
  validate({ query: participantsQuerySchema }),
  asyncHandler(listParticipants),
);
eventRegistryRouter.post(
  '/:id/confirm-index',
  requireAuth,
  requireRole(Role.officer, Role.manager, Role.admin),
  validate({ body: confirmIndexSchema }),
  asyncHandler(confirmIndex),
);
eventRegistryRouter.post(
  '/:id/check-participant',
  requireAuth,
  requireRole(
    Role.student,
    Role.class_representative,
    Role.officer,
    Role.manager,
    Role.committee,
    Role.admin,
  ),
  validate({ body: checkParticipantSchema }),
  asyncHandler(checkParticipant),
);
eventRegistryRouter.post(
  '/:id/participants/import',
  requireAuth,
  requireRole(Role.officer, Role.manager, Role.admin),
  validate({ body: importParticipantsJsonSchema }),
  asyncHandler(importParticipants),
);
eventRegistryRouter.post(
  '/:id/import-as-evidence',
  requireAuth,
  requireRole(
    Role.student,
    Role.class_representative,
    Role.officer,
    Role.manager,
    Role.admin,
  ),
  validate({ body: importAsEvidenceSchema }),
  asyncHandler(importEventAsEvidence),
);
eventRegistryRouter.post(
  '/:id/import-to-application',
  requireAuth,
  requireRole(
    Role.student,
    Role.class_representative,
    Role.officer,
    Role.manager,
    Role.admin,
  ),
  validate({ body: importToApplicationSchema }),
  asyncHandler(importEventToApplication),
);

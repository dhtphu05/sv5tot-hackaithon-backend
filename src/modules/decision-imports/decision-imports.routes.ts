import { Role } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { uploadMiddleware } from '../../middlewares/upload.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import {
  cancelDecisionImport,
  confirmDecisionImport,
  createDecisionImport,
  getDecisionAudit,
  getDecisionImport,
  getDecisionMetadata,
  getDecisionPreview,
  getDecisionStatus,
  getDecisionTables,
  listDecisionImports,
  startDecisionImport,
  updateDecisionColumnMapping,
  uploadDecisionFile,
} from './decision-imports.controller';
import {
  confirmDecisionImportSchema,
  createDecisionImportSchema,
  listDecisionImportsQuerySchema,
  startDecisionImportSchema,
  updateColumnMappingSchema,
} from './decision-imports.validation';

export const decisionImportsRouter = Router();

decisionImportsRouter.use(requireAuth, requireRole(Role.officer, Role.manager, Role.admin));

decisionImportsRouter.get(
  '/',
  validate({ query: listDecisionImportsQuerySchema }),
  asyncHandler(listDecisionImports),
);
decisionImportsRouter.post(
  '/',
  validate({ body: createDecisionImportSchema }),
  asyncHandler(createDecisionImport),
);
decisionImportsRouter.get('/:id', asyncHandler(getDecisionImport));
decisionImportsRouter.post('/:id/files', uploadMiddleware.single('file'), asyncHandler(uploadDecisionFile));
decisionImportsRouter.post(
  '/:id/start',
  validate({ body: startDecisionImportSchema }),
  asyncHandler(startDecisionImport),
);
decisionImportsRouter.get('/:id/status', asyncHandler(getDecisionStatus));
decisionImportsRouter.get('/:id/metadata', asyncHandler(getDecisionMetadata));
decisionImportsRouter.get('/:id/tables', asyncHandler(getDecisionTables));
decisionImportsRouter.get('/:id/preview', asyncHandler(getDecisionPreview));
decisionImportsRouter.get('/:id/audit', asyncHandler(getDecisionAudit));
decisionImportsRouter.patch(
  '/:id/column-mapping',
  validate({ body: updateColumnMappingSchema }),
  asyncHandler(updateDecisionColumnMapping),
);
decisionImportsRouter.post(
  '/:id/confirm',
  validate({ body: confirmDecisionImportSchema }),
  asyncHandler(confirmDecisionImport),
);
decisionImportsRouter.post('/:id/cancel', asyncHandler(cancelDecisionImport));

import { Router } from 'express';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import { requireSmartbotWebhookToken } from './smartbot-hooks.auth';
import {
  applicationStatus,
  cascadeSummary,
  createHandoffTicket,
  eventSearch,
  evidenceCardSummary,
  precheckSummary,
  reviewerDraftResponse,
} from './smartbot-hooks.controller';
import {
  applicationToolSchema,
  eventSearchToolSchema,
  evidenceToolSchema,
  handoffToolSchema,
  reviewerDraftToolSchema,
} from './smartbot-hooks.validation';

export const smartbotHooksRouter = Router();

smartbotHooksRouter.use(requireSmartbotWebhookToken);

smartbotHooksRouter.post('/tools/application-status', validate({ body: applicationToolSchema }), asyncHandler(applicationStatus));
smartbotHooksRouter.post('/tools/precheck-summary', validate({ body: applicationToolSchema }), asyncHandler(precheckSummary));
smartbotHooksRouter.post('/tools/cascade-summary', validate({ body: applicationToolSchema }), asyncHandler(cascadeSummary));
smartbotHooksRouter.post('/tools/evidence-card-summary', validate({ body: evidenceToolSchema }), asyncHandler(evidenceCardSummary));
smartbotHooksRouter.post('/tools/event-search', validate({ body: eventSearchToolSchema }), asyncHandler(eventSearch));
smartbotHooksRouter.post('/tools/reviewer-draft-response', validate({ body: reviewerDraftToolSchema }), asyncHandler(reviewerDraftResponse));
smartbotHooksRouter.post('/tools/create-handoff-ticket', validate({ body: handoffToolSchema }), asyncHandler(createHandoffTicket));

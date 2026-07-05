import { Role } from '@prisma/client';
import rateLimit from 'express-rate-limit';
import { Router } from 'express';
import { securityConfig } from '../../config/security';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { ErrorCodes } from '../../shared/errors/error-codes';
import { asyncHandler } from '../../shared/utils/async-handler';
import {
  cancelChatbotAction,
  confirmChatbotAction,
  executeChatbotAction,
} from './chatbot-action.controller';
import { sendChatbotMessage, streamChatbotMessage } from './chatbot.controller';
import { chatbotMessageSchema } from './chatbot.validation';

export const chatbotRouter = Router();

const chatbotRateLimit = rateLimit({
  windowMs: securityConfig.chatbotRateLimitWindowMs,
  limit: securityConfig.chatbotRateLimitMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    data: null,
    error: {
      code: ErrorCodes.RATE_LIMITED,
      message: 'Too many chatbot requests',
    },
    meta: {},
  },
});

chatbotRouter.post(
  '/message',
  chatbotRateLimit,
  requireAuth,
  requireRole(
    Role.student,
    Role.class_representative,
    Role.officer,
    Role.manager,
    Role.committee,
    Role.admin,
  ),
  validate({ body: chatbotMessageSchema }),
  asyncHandler(sendChatbotMessage),
);

chatbotRouter.post(
  '/stream',
  chatbotRateLimit,
  requireAuth,
  requireRole(
    Role.student,
    Role.class_representative,
    Role.officer,
    Role.manager,
    Role.committee,
    Role.admin,
  ),
  validate({ body: chatbotMessageSchema }),
  asyncHandler(streamChatbotMessage),
);

chatbotRouter.post(
  '/actions/:actionId/confirm',
  requireAuth,
  asyncHandler(confirmChatbotAction),
);

chatbotRouter.post(
  '/actions/:actionId/execute',
  requireAuth,
  asyncHandler(executeChatbotAction),
);

chatbotRouter.post(
  '/actions/:actionId/cancel',
  requireAuth,
  asyncHandler(cancelChatbotAction),
);

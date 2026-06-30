import rateLimit from 'express-rate-limit';
import { securityConfig } from '../config/security';
import { ErrorCodes } from '../shared/errors/error-codes';

export const rateLimitMiddleware = rateLimit({
  windowMs: securityConfig.rateLimitWindowMs,
  limit: securityConfig.rateLimitMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    data: null,
    error: {
      code: ErrorCodes.RATE_LIMITED,
      message: 'Too many requests',
    },
    meta: {},
  },
});

export const loginRateLimitMiddleware = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    data: null,
    error: {
      code: ErrorCodes.RATE_LIMITED,
      message: 'Too many login attempts',
    },
    meta: {},
  },
});

import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { loginRateLimitMiddleware } from '../../middlewares/rate-limit.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import { login, logout, refresh } from './auth.controller';
import { loginSchema, logoutSchema, refreshSchema } from './auth.validation';

export const authRouter = Router();

authRouter.post(
  '/login',
  loginRateLimitMiddleware,
  validate({ body: loginSchema }),
  asyncHandler(login),
);
authRouter.post('/refresh', validate({ body: refreshSchema }), asyncHandler(refresh));
authRouter.post('/logout', requireAuth, validate({ body: logoutSchema }), asyncHandler(logout));

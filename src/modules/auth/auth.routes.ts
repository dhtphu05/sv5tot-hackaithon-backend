import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { loginRateLimitMiddleware } from '../../middlewares/rate-limit.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import { login, logout, refresh, register } from './auth.controller';
import { loginSchema, logoutSchema, refreshSchema, registerSchema } from './auth.validation';

export const authRouter = Router();

authRouter.post(
  '/register',
  loginRateLimitMiddleware,
  validate({ body: registerSchema }),
  asyncHandler(register),
);
authRouter.post(
  '/login',
  loginRateLimitMiddleware,
  validate({ body: loginSchema }),
  asyncHandler(login),
);
authRouter.post('/refresh', validate({ body: refreshSchema }), asyncHandler(refresh));
authRouter.post('/logout', requireAuth, validate({ body: logoutSchema }), asyncHandler(logout));

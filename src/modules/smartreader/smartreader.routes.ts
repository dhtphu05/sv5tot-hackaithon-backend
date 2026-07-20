import { Role } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { env } from '../../config/env';
import { prisma } from '../../infrastructure/database/prisma';
import { uploadMiddleware } from '../../middlewares/upload.middleware';
import { TokenService } from '../auth/token.service';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import { asyncHandler } from '../../shared/utils/async-handler';
import { adminDocTest, asyncTest, ocrTest, uploadTest } from './smartreader.controller';

export const smartReaderRouter = Router();

const tokenService = new TokenService();

smartReaderRouter.post(
  '/upload-test',
  internalSmartReaderAuth,
  uploadMiddleware.single('file'),
  asyncHandler(uploadTest),
);
smartReaderRouter.post(
  '/ocr-test',
  internalSmartReaderAuth,
  uploadMiddleware.single('file'),
  asyncHandler(ocrTest),
);
smartReaderRouter.post(
  '/admin-doc-test',
  internalSmartReaderAuth,
  uploadMiddleware.single('file'),
  asyncHandler(adminDocTest),
);
smartReaderRouter.post(
  '/async-test',
  internalSmartReaderAuth,
  uploadMiddleware.single('file'),
  asyncHandler(asyncTest),
);

async function internalSmartReaderAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const internalToken = req.header('x-internal-worker-token');
    if (env.INTERNAL_WORKER_TOKEN && internalToken === env.INTERNAL_WORKER_TOKEN) {
      next();
      return;
    }

    const authorization = req.header('authorization');
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : null;

    if (!token) {
      next(new AppError(401, ErrorCodes.UNAUTHORIZED, 'Authentication is required'));
      return;
    }

    const payload = tokenService.verifyAccessToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive || user.role !== Role.admin) {
      next(new AppError(403, ErrorCodes.FORBIDDEN, 'Admin role or internal worker token is required'));
      return;
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      fullName: user.fullName,
      studentCode: user.studentCode,
      className: user.className,
      faculty: user.faculty,
      avatarUrl: user.avatarUrl,
      workspaceId: user.workspaceId,
      workspace: null,
    };
    next();
  } catch (error) {
    next(error);
  }
}

import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../infrastructure/database/prisma';
import { TokenService } from '../modules/auth/token.service';
import { AppError } from '../shared/errors/app-error';
import { ErrorCodes } from '../shared/errors/error-codes';

const tokenService = new TokenService();

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
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

    if (!user) {
      next(new AppError(401, ErrorCodes.UNAUTHORIZED, 'Authenticated user was not found'));
      return;
    }

    if (!user.isActive) {
      next(new AppError(403, ErrorCodes.USER_INACTIVE, 'User account is inactive'));
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
    };

    next();
  } catch (error) {
    next(error);
  }
}

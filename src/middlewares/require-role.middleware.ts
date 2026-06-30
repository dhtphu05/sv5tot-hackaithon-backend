import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { AppError } from '../shared/errors/app-error';
import { ErrorCodes } from '../shared/errors/error-codes';

export function requireRole(...allowedRoles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new AppError(401, ErrorCodes.UNAUTHORIZED, 'Authentication is required'));
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      next(new AppError(403, ErrorCodes.FORBIDDEN, 'Insufficient permissions'));
      return;
    }

    next();
  };
}

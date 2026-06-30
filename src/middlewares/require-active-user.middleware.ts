import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../shared/errors/app-error';
import { ErrorCodes } from '../shared/errors/error-codes';

export function requireActiveUser(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(new AppError(401, ErrorCodes.UNAUTHORIZED, 'Authentication is required'));
    return;
  }

  next();
}

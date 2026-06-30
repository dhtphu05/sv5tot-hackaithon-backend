import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../shared/errors/app-error';
import { ErrorCodes } from '../shared/errors/error-codes';

export function notFoundMiddleware(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(404, ErrorCodes.NOT_FOUND, `Route ${req.method} ${req.path} not found`));
}

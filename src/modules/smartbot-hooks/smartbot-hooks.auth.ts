import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../../config/env';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';

export function requireSmartbotWebhookToken(req: Request, _res: Response, next: NextFunction): void {
  if (!env.SMARTBOT_WEBHOOK_TOKEN) {
    next(
      new AppError(
        503,
        ErrorCodes.SMARTBOT_WEBHOOK_UNAVAILABLE,
        'Smartbot webhook tools are not enabled in this environment',
      ),
    );
    return;
  }

  const authorization = req.header('authorization');
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';

  if (!safeEqual(token, env.SMARTBOT_WEBHOOK_TOKEN)) {
    next(new AppError(401, ErrorCodes.UNAUTHORIZED, 'Invalid Smartbot webhook token'));
    return;
  }

  next();
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

import type { NextFunction, Request, Response } from 'express';
import { logger } from '../config/logger';

const WARN_THRESHOLD_MS = 1_000;
const SLOW_THRESHOLD_MS = 3_000;

const HOT_PATHS = [
  '/api/review/tasks',
  '/api/manager/applications',
  '/api/dashboard',
  '/api/officer/dashboard',
  '/api/notifications',
  '/api/applications/current',
];

export function performanceLogMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const user = req.user;
    const payload = {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Math.round(durationMs),
      userId: user?.id,
      role: user?.role,
      requestId: req.requestId,
      query: req.query,
      hotPath: HOT_PATHS.some((path) => req.path.startsWith(path)),
    };

    if (durationMs >= SLOW_THRESHOLD_MS) {
      logger.warn(payload, 'Slow API request');
      return;
    }

    if (durationMs >= WARN_THRESHOLD_MS) {
      logger.warn(payload, 'API request exceeded warning threshold');
      return;
    }

    logger.debug(payload, 'API request completed');
  });

  next();
}

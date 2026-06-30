import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses/api-response';
import { toIsoTimestamp } from '../../shared/utils/date';

export function getHealth(req: Request, res: Response): void {
  sendSuccess(
    res,
    {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: toIsoTimestamp(),
    },
    { requestId: req.requestId },
  );
}

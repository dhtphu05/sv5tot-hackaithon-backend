import type { Request, Response } from 'express';
import packageJson from '../../../package.json';
import { env } from '../../config/env';
import { sendSuccess } from '../../shared/responses/api-response';

export function getVersion(req: Request, res: Response): void {
  sendSuccess(
    res,
    {
      name: '5TOT Backend API',
      version: packageJson.version,
      environment: env.NODE_ENV,
    },
    { requestId: req.requestId },
  );
}

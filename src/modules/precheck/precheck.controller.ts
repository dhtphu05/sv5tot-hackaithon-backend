// Owns AI-assisted precheck orchestration results for applications.
import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses/api-response';
import { PrecheckService } from './precheck.service';

const service = new PrecheckService();

export async function runApplicationPrecheck(req: Request, res: Response): Promise<void> {
  const data = await service.run(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function getLatestApplicationPrecheck(req: Request, res: Response): Promise<void> {
  const data = await service.getLatest(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function getLatestCurrentApplicationPrecheck(
  req: Request,
  res: Response,
): Promise<void> {
  const schoolYear = typeof req.query.schoolYear === 'string' ? req.query.schoolYear : undefined;
  const data = await service.getLatestCurrent(req.user!, schoolYear);
  sendSuccess(res, data, { requestId: req.requestId });
}

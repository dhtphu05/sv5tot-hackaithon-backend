// Owns target-level cascade analysis and human confirmation state.
import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses/api-response';
import { CascadeService } from './cascade.service';

const service = new CascadeService();

export async function runApplicationCascadeReview(req: Request, res: Response): Promise<void> {
  const data = await service.run(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function getLatestApplicationCascadeReview(
  req: Request,
  res: Response,
): Promise<void> {
  const data = await service.getLatest(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

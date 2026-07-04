// Owns indexing and async job visibility plus processor registration.
import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses/api-response';
import { JobsService } from './jobs.service';

const jobsService = new JobsService();

export async function getJob(req: Request, res: Response): Promise<void> {
  const data = await jobsService.getJob(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function runJob(req: Request, res: Response): Promise<void> {
  const data = await jobsService.runJob(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function runWorkerTick(req: Request, res: Response): Promise<void> {
  const data = await jobsService.runWorkerTick();
  sendSuccess(res, data, { requestId: req.requestId });
}

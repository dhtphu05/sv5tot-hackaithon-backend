import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses/api-response';
import { EmailWorkerService } from './email-worker.service';

const workerService = new EmailWorkerService();

export async function runEmailWorkerTick(req: Request, res: Response): Promise<void> {
  const data = await workerService.runTick();
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function retryEmailOutbox(req: Request, res: Response): Promise<void> {
  const data = await workerService.retry(String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

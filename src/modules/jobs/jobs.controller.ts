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

export async function retryJob(req: Request, res: Response): Promise<void> {
  const data = await jobsService.retryJob(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function runWorkerTick(req: Request, res: Response): Promise<void> {
  const data = await jobsService.runWorkerTick();
  const safeData =
    data.job?.jobType === 'award_roster_ingestion'
      ? { ...data, job: { jobType: data.job.jobType, status: data.job.status } }
      : data;
  sendSuccess(res, safeData, { requestId: req.requestId });
}

// Owns management dashboards, workload views, and review assignment.
import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses/api-response';
import { ManagerService } from './manager.service';

const service = new ManagerService();

export async function listManagerApplications(req: Request, res: Response): Promise<void> {
  const data = await service.listApplications(req.query as never);
  sendSuccess(res, data.items, { requestId: req.requestId, pagination: data.pagination });
}

export async function getManagerWorkloads(req: Request, res: Response): Promise<void> {
  const data = await service.getWorkloads();
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function assignManagerReviewTask(req: Request, res: Response): Promise<void> {
  const data = await service.assignTask(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function getApplicationAggregation(req: Request, res: Response): Promise<void> {
  const data = await service.getAggregation(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function finalizeApplication(req: Request, res: Response): Promise<void> {
  const data = await service.finalizeApplication(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function reopenFinalApplication(req: Request, res: Response): Promise<void> {
  const data = await service.reopenFinal(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId });
}

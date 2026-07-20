// Owns management dashboards, workload views, and review assignment.
import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses/api-response';
import { ManagerService } from './manager.service';

const service = new ManagerService();

export async function listManagerApplications(req: Request, res: Response): Promise<void> {
  const data = await service.listApplications(req.user!, req.query as never);
  sendSuccess(res, { items: data.items }, { requestId: req.requestId, pagination: data.pagination });
}

export async function getManagerWorkloads(req: Request, res: Response): Promise<void> {
  const data = await service.getWorkloads(req.user!);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function getManagerDashboardSummary(req: Request, res: Response): Promise<void> {
  const data = await service.getDashboardSummary(req.user!);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function listManagerResults(req: Request, res: Response): Promise<void> {
  const data = await service.listResults(req.user!, req.query as never);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function getCommitteeInbox(req: Request, res: Response): Promise<void> {
  const data = await service.getCommitteeInbox(req.user!, req.query as never);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function getManagerResultDetail(req: Request, res: Response): Promise<void> {
  const data = await service.getResultDetail(req.user!, String(req.params.applicationId));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function assignManagerReviewTask(req: Request, res: Response): Promise<void> {
  const data = await service.reassignTask(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function getApplicationAggregation(req: Request, res: Response): Promise<void> {
  const data = await service.getAggregation(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function getApplicationSummary(req: Request, res: Response): Promise<void> {
  const data = await service.getApplicationSummary(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function aggregateApplication(req: Request, res: Response): Promise<void> {
  const data = await service.aggregateApplication(req.user!, String(req.params.id), req.body);
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

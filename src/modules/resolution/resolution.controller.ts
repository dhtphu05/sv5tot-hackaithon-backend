// Owns committee resolution cases and final dispute decisions.
import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses/api-response';
import { ResolutionService } from './resolution.service';

const service = new ResolutionService();

export async function listResolutionCases(req: Request, res: Response): Promise<void> {
  const data = await service.listCases(req.user!, req.query as never);
  sendSuccess(res, { items: data.items }, { requestId: req.requestId, pagination: data.pagination });
}

export async function getResolutionCase(req: Request, res: Response): Promise<void> {
  const data = await service.getCaseDetail(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function decideResolutionCase(req: Request, res: Response): Promise<void> {
  const data = await service.resolveCase(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function updateResolutionCaseStatus(req: Request, res: Response): Promise<void> {
  const data = await service.updateCaseStatus(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function reopenResolutionCase(req: Request, res: Response): Promise<void> {
  const data = await service.reopenCase(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId });
}

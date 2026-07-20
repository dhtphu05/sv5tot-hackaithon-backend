// Owns officer review tasks, decisions, supplements, and escalation.
import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses/api-response';
import { ReviewService } from './review.service';

const service = new ReviewService();

export async function getReviewDashboard(req: Request, res: Response): Promise<void> {
  const data = await service.getDashboard(req.user!);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function listReviewTasks(req: Request, res: Response): Promise<void> {
  const data = await service.listTasks(req.user!, req.query as never);
  sendSuccess(
    res,
    { items: data.items },
    { requestId: req.requestId, pagination: data.pagination },
  );
}

export async function getReviewTaskDetail(req: Request, res: Response): Promise<void> {
  const data = await service.getTaskDetail(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function getCriterionLevelAssessment(req: Request, res: Response): Promise<void> {
  const data = await service.getCriterionLevelAssessment(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function getReviewTaskTimeline(req: Request, res: Response): Promise<void> {
  const data = await service.getTaskTimeline(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function checkReviewTaskPrecedents(req: Request, res: Response): Promise<void> {
  const data = await service.checkPrecedents(req.user!, String(req.params.id), req.query as never);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function claimReviewTask(req: Request, res: Response): Promise<void> {
  const data = await service.claimTask(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function ensureReviewTasks(req: Request, res: Response): Promise<void> {
  const data = await service.ensureReviewTasks(
    req.user!,
    String(req.params.applicationId),
    req.body,
  );
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function decideReviewTask(req: Request, res: Response): Promise<void> {
  const data = await service.decideTask(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function requestReviewTaskSupplement(req: Request, res: Response): Promise<void> {
  const data = await service.requestSupplement(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function escalateReviewTaskResolution(req: Request, res: Response): Promise<void> {
  const data = await service.escalateResolution(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId });
}

// Owns individual application draft, submission, timeline, supplement lifecycle.
import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses/api-response';
import { ApplicationsService } from './applications.service';

const applicationsService = new ApplicationsService();

export async function getCurrentApplication(req: Request, res: Response): Promise<void> {
  const data = await applicationsService.getCurrent(req.user!, req.query as never);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function startCurrentApplication(req: Request, res: Response): Promise<void> {
  const data = await applicationsService.startCurrent(req.user!, req.body);
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function updateApplicationTargetLevel(req: Request, res: Response): Promise<void> {
  const data = await applicationsService.updateTargetLevel(
    req.user!,
    String(req.params.id),
    req.body,
  );
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function autosaveApplicationDraft(req: Request, res: Response): Promise<void> {
  const data = await applicationsService.autosaveDraft(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function getApplicationTimeline(req: Request, res: Response): Promise<void> {
  const data = await applicationsService.getTimeline(
    req.user!,
    String(req.params.id),
    req.query as never,
  );
  sendSuccess(res, data.items, { requestId: req.requestId, pagination: data.pagination });
}

export async function submitApplication(req: Request, res: Response): Promise<void> {
  const data = await applicationsService.submit(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function reopenApplicationSupplement(req: Request, res: Response): Promise<void> {
  const data = await applicationsService.reopenSupplement(
    req.user!,
    String(req.params.id),
    req.body,
  );
  sendSuccess(res, data, { requestId: req.requestId });
}

import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses/api-response';
import { AwardDecisionsService } from './award-decisions.service';
import { AwardRosterService } from './award-roster.service';

const service = new AwardDecisionsService();
const rosterService = new AwardRosterService();

export async function listAwardDecisions(req: Request, res: Response): Promise<void> {
  const data = await service.list(req.user!, req.query as never);
  sendSuccess(res, { items: data.items }, { requestId: req.requestId, pagination: data.pagination });
}

export async function createAwardDecision(req: Request, res: Response): Promise<void> {
  const data = await service.create(req.user!, req.body);
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function getAwardDecision(req: Request, res: Response): Promise<void> {
  const data = await service.getDetail(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function updateAwardDecision(req: Request, res: Response): Promise<void> {
  const data = await service.update(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function uploadAwardDecisionFile(req: Request, res: Response): Promise<void> {
  const data = await service.uploadFile(
    req.user!,
    String(req.params.id),
    String(req.params.kind),
    req.file,
  );
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function processAwardRoster(req: Request, res: Response): Promise<void> {
  const data = await rosterService.processRoster(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId }, 202);
}

export async function getAwardRosterProcessing(req: Request, res: Response): Promise<void> {
  const data = await rosterService.getProcessing(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function getAwardRosterPreview(req: Request, res: Response): Promise<void> {
  const data = await rosterService.getPreview(req.user!, String(req.params.id), req.query as never);
  sendSuccess(res, data, { requestId: req.requestId, pagination: data.pagination });
}

export async function updateAwardRosterMapping(req: Request, res: Response): Promise<void> {
  const data = await rosterService.updateMapping(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId, pagination: data.pagination });
}

export async function confirmAwardDecision(req: Request, res: Response): Promise<void> {
  const data = await rosterService.confirm(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function getAwardDecisionRecipients(req: Request, res: Response): Promise<void> {
  const data = await rosterService.listRecipients(req.user!, String(req.params.id), req.query as never);
  sendSuccess(res, { items: data.items }, { requestId: req.requestId, pagination: data.pagination });
}

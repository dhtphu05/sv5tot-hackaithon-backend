import type { Request, Response } from 'express';
import { SmartbotHooksService } from './smartbot-hooks.service';

const service = new SmartbotHooksService();

export async function applicationStatus(req: Request, res: Response): Promise<void> {
  res.json(await service.applicationStatus(req.body));
}

export async function precheckSummary(req: Request, res: Response): Promise<void> {
  res.json(await service.precheckSummary(req.body));
}

export async function cascadeSummary(req: Request, res: Response): Promise<void> {
  res.json(await service.cascadeSummary(req.body));
}

export async function evidenceCardSummary(req: Request, res: Response): Promise<void> {
  res.json(await service.evidenceCardSummary(req.body));
}

export async function eventSearch(req: Request, res: Response): Promise<void> {
  res.json(await service.eventSearch(req.body));
}

export async function reviewerDraftResponse(req: Request, res: Response): Promise<void> {
  res.json(await service.reviewerDraftResponse(req.body));
}

export async function createHandoffTicket(req: Request, res: Response): Promise<void> {
  res.json(await service.createHandoffTicket(req.body));
}

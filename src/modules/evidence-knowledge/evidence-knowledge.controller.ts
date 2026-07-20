import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses/api-response';
import { EvidenceKnowledgeService } from './evidence-knowledge.service';

const service = new EvidenceKnowledgeService();

export async function searchOfficerEvidenceKnowledge(req: Request, res: Response): Promise<void> {
  const data = await service.searchOfficer(req.user!, req.query as never);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function getOfficerEvidenceKnowledgeEvent(req: Request, res: Response): Promise<void> {
  const data = await service.getOfficerEvent(req.user!, String(req.params.eventId));
  sendSuccess(res, data, { requestId: req.requestId });
}

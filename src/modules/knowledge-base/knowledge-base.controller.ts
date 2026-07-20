// Owns reviewed evidence knowledge, reusable criteria references, and search.
import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses/api-response';
import { KnowledgeBaseService } from './knowledge-base.service';

const service = new KnowledgeBaseService();

export async function searchKnowledgeBase(req: Request, res: Response): Promise<void> {
  const data = await service.search(req.user!, req.query as never);
  sendSuccess(res, { items: data.items }, { requestId: req.requestId, pagination: data.pagination });
}

export async function searchApprovedEvidenceNames(req: Request, res: Response): Promise<void> {
  const data = await service.searchApprovedEvidenceNames(req.user!, req.query as never);
  sendSuccess(res, { items: data.items }, { requestId: req.requestId, pagination: data.pagination });
}

export async function getKnowledgeBaseItem(req: Request, res: Response): Promise<void> {
  const data = await service.getItem(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function createKnowledgeBaseFromEvidence(req: Request, res: Response): Promise<void> {
  const data = await service.createFromReviewedEvidence(req.user!, req.body);
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function updateKnowledgeBaseItem(req: Request, res: Response): Promise<void> {
  const data = await service.updateItem(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function useKnowledgeBaseItem(req: Request, res: Response): Promise<void> {
  const data = await service.useItem(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

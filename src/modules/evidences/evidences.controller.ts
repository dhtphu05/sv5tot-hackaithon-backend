// Owns evidence records, evidence files, indexing triggers, and evidence cards.
import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses/api-response';
import { EvidencesService } from './evidences.service';

const evidencesService = new EvidencesService();

export async function listApplicationEvidences(req: Request, res: Response): Promise<void> {
  const data = await evidencesService.list(req.user!, String(req.params.id), req.query as never);
  sendSuccess(res, data.items, { requestId: req.requestId, pagination: data.pagination });
}

export async function createApplicationEvidence(req: Request, res: Response): Promise<void> {
  const data = await evidencesService.create(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function updateEvidence(req: Request, res: Response): Promise<void> {
  const data = await evidencesService.update(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function deleteEvidence(req: Request, res: Response): Promise<void> {
  const data = await evidencesService.delete(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function uploadEvidenceFile(req: Request, res: Response): Promise<void> {
  const data = await evidencesService.uploadFile(req.user!, String(req.params.id), req.file);
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function startEvidenceIndexing(req: Request, res: Response): Promise<void> {
  const data = await evidencesService.startIndexing(
    req.user!,
    String(req.params.id),
    req.body ?? {},
  );
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function getEvidenceCard(req: Request, res: Response): Promise<void> {
  const data = await evidencesService.getCard(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

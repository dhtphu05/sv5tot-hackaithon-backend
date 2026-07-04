import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses/api-response';
import { EventRegistryService } from '../event-registry/event-registry.service';
import { EvidenceMatchingService } from './evidence-matching.service';

const evidenceMatchingService = new EvidenceMatchingService();
const eventRegistryService = new EventRegistryService();

export async function searchEvidenceMatching(req: Request, res: Response): Promise<void> {
  const data = await evidenceMatchingService.search(req.user!, req.query as never);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function importEvidenceMatching(req: Request, res: Response): Promise<void> {
  const data = await eventRegistryService.importAsEvidence(req.user!, String(req.params.eventId), req.body);
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

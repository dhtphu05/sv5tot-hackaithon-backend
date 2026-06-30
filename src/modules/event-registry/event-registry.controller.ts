// Owns event registry, roster indexing, participants, and application imports.
import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses/api-response';
import { EventRegistryService } from './event-registry.service';

const service = new EventRegistryService();

export async function listEvents(req: Request, res: Response): Promise<void> {
  const data = await service.list(req.user!, req.query as never);
  sendSuccess(res, data.items, { requestId: req.requestId, pagination: data.pagination });
}

export async function createEvent(req: Request, res: Response): Promise<void> {
  const data = await service.create(req.user!, req.body);
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function getEvent(req: Request, res: Response): Promise<void> {
  const data = await service.getDetail(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function updateEvent(req: Request, res: Response): Promise<void> {
  const data = await service.update(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function uploadRosterFile(req: Request, res: Response): Promise<void> {
  const data = await service.uploadRosterFile(req.user!, String(req.params.id), req.file);
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function startRosterIndexing(req: Request, res: Response): Promise<void> {
  const data = await service.startIndexing(req.user!, String(req.params.id), req.body ?? {});
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function listParticipants(req: Request, res: Response): Promise<void> {
  const data = await service.listParticipants(req.user!, String(req.params.id), req.query as never);
  sendSuccess(res, data.items, { requestId: req.requestId, pagination: data.pagination });
}

export async function confirmIndex(req: Request, res: Response): Promise<void> {
  const data = await service.confirmIndex(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function checkParticipant(req: Request, res: Response): Promise<void> {
  const data = await service.checkParticipant(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function importEventToApplication(req: Request, res: Response): Promise<void> {
  const data = await service.importToApplication(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

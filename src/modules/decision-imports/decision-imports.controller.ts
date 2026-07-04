import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses/api-response';
import { DecisionImportsService } from './decision-imports.service';

const service = new DecisionImportsService();

export async function listDecisionImports(req: Request, res: Response): Promise<void> {
  const data = await service.list(req.user!, req.query as never);
  sendSuccess(res, { items: data.items }, { requestId: req.requestId, pagination: data.pagination });
}

export async function createDecisionImport(req: Request, res: Response): Promise<void> {
  const data = await service.create(req.user!, req.body);
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function getDecisionImport(req: Request, res: Response): Promise<void> {
  const data = await service.getDetail(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function uploadDecisionFile(req: Request, res: Response): Promise<void> {
  const data = await service.uploadFile(req.user!, String(req.params.id), req.file);
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function startDecisionImport(req: Request, res: Response): Promise<void> {
  const data = await service.start(req.user!, String(req.params.id), req.body ?? {});
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function getDecisionStatus(req: Request, res: Response): Promise<void> {
  const data = await service.status(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function getDecisionMetadata(req: Request, res: Response): Promise<void> {
  const data = await service.metadata(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function getDecisionTables(req: Request, res: Response): Promise<void> {
  const data = await service.tables(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function getDecisionPreview(req: Request, res: Response): Promise<void> {
  const data = await service.preview(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function getDecisionAudit(req: Request, res: Response): Promise<void> {
  const data = await service.audit(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function updateDecisionColumnMapping(req: Request, res: Response): Promise<void> {
  const data = await service.updateColumnMapping(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function confirmDecisionImport(req: Request, res: Response): Promise<void> {
  const data = await service.confirm(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function cancelDecisionImport(req: Request, res: Response): Promise<void> {
  const data = await service.cancel(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses/api-response';
import { CollectiveService } from './collective.service';

const service = new CollectiveService();

export async function getCurrentCollective(req: Request, res: Response): Promise<void> {
  const data = await service.getCurrent(req.user!, req.query as never);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function startCurrentCollective(req: Request, res: Response): Promise<void> {
  const data = await service.start(req.user!, req.body);
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function getCollectiveDetail(req: Request, res: Response): Promise<void> {
  const data = await service.getDetail(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function updateCollective(req: Request, res: Response): Promise<void> {
  const data = await service.update(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function listCollectiveMembers(req: Request, res: Response): Promise<void> {
  const data = await service.listMembers(req.user!, String(req.params.id), req.query as never);
  sendSuccess(res, data.items, {
    requestId: req.requestId,
    pagination: data.pagination,
    memberSummary: data.memberSummary,
  });
}

export async function upsertCollectiveMember(req: Request, res: Response): Promise<void> {
  const data = await service.upsertMember(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function importCollectiveRoster(req: Request, res: Response): Promise<void> {
  const data = await service.importRoster(req.user!, String(req.params.id), req.file);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function updateCollectiveMember(req: Request, res: Response): Promise<void> {
  const data = await service.updateMember(
    req.user!,
    String(req.params.id),
    String(req.params.memberId),
    req.body,
  );
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function deleteCollectiveMember(req: Request, res: Response): Promise<void> {
  const data = await service.deleteMember(
    req.user!,
    String(req.params.id),
    String(req.params.memberId),
  );
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function listCollectiveEvidences(req: Request, res: Response): Promise<void> {
  const data = await service.listEvidences(req.user!, String(req.params.id), req.query as never);
  sendSuccess(res, data.items, { requestId: req.requestId, pagination: data.pagination });
}

export async function createCollectiveEvidence(req: Request, res: Response): Promise<void> {
  const data = await service.createEvidence(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function uploadCollectiveEvidenceFile(req: Request, res: Response): Promise<void> {
  const data = await service.uploadEvidenceFile(req.user!, String(req.params.evidenceId), req.file);
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function startCollectiveEvidenceIndexing(req: Request, res: Response): Promise<void> {
  const data = await service.startEvidenceIndexing(
    req.user!,
    String(req.params.evidenceId),
    req.body,
  );
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function importCollectiveEvent(req: Request, res: Response): Promise<void> {
  const data = await service.importEvent(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function runCollectivePrecheck(req: Request, res: Response): Promise<void> {
  const data = await service.precheck(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function getLatestCollectivePrecheck(req: Request, res: Response): Promise<void> {
  const data = await service.latestPrecheck(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function submitCollective(req: Request, res: Response): Promise<void> {
  const data = await service.submit(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function listManagerCollectives(req: Request, res: Response): Promise<void> {
  const data = await service.listForManager(req.user!, req.query as never);
  sendSuccess(res, data.items, { requestId: req.requestId, pagination: data.pagination });
}

export async function getCollectiveAggregation(req: Request, res: Response): Promise<void> {
  const data = await service.aggregation(String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function finalizeCollective(req: Request, res: Response): Promise<void> {
  const data = await service.finalize(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId });
}

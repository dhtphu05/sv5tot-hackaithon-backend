// Owns immutable audit log querying for privileged users.
import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses/api-response';
import { AuditService } from './audit.service';
import { listAuditLogsQuerySchema } from './audit.validation';

const service = new AuditService();

export async function listAuditLogs(req: Request, res: Response): Promise<void> {
  const query = listAuditLogsQuerySchema.parse(req.query);
  const data = await service.listLogs(query);
  sendSuccess(res, data, { requestId: req.requestId, count: data.length });
}

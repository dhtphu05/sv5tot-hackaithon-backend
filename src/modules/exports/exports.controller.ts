// Owns export job requests for applications and review results.
import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses/api-response';
import { ExportsService } from './exports.service';

const service = new ExportsService();

export async function exportReviewResults(req: Request, res: Response): Promise<void> {
  const data = await service.exportReviewResults(req.user!, req.body);
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function downloadExportFile(req: Request, res: Response): Promise<void> {
  const data = await service.getDownloadFile(req.user!, String(req.params.fileId));
  res.download(data.absolutePath, data.file.originalName);
}

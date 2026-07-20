// Owns export job requests for applications and review results.
import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses/api-response';
import { ExportsService } from './exports.service';

const service = new ExportsService();

export async function exportApplicationsJson(req: Request, res: Response): Promise<void> {
  const data = await service.exportApplicationsJson(req.user!, req.query as never);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function exportApplicationsCsv(req: Request, res: Response): Promise<void> {
  const csv = await service.exportApplicationsCsv(req.user!, req.query as never);
  sendCsv(res, csv, `sv5t-applications-${dateStamp()}.csv`);
}

export async function exportReviewTasksCsv(req: Request, res: Response): Promise<void> {
  const csv = await service.exportReviewTasksCsv(req.user!, req.query as never);
  sendCsv(res, csv, `sv5t-review-tasks-${dateStamp()}.csv`);
}

export async function exportReviewResults(req: Request, res: Response): Promise<void> {
  const data = await service.exportReviewResults(req.user!, req.body);
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function downloadExportFile(req: Request, res: Response): Promise<void> {
  const data = await service.getDownloadFile(req.user!, String(req.params.fileId));
  const signedUrl = 'signedUrl' in data && typeof data.signedUrl === 'string' ? data.signedUrl : null;
  if (signedUrl) {
    res.redirect(signedUrl);
    return;
  }
  const absolutePath =
    'absolutePath' in data && typeof data.absolutePath === 'string' ? data.absolutePath : null;
  if (absolutePath) {
    res.download(absolutePath, data.file.originalName);
  }
}

function sendCsv(res: Response, csv: string, filename: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(`\uFEFF${csv}`);
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

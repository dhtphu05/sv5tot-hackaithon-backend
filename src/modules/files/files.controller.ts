// Owns file metadata and storage integration boundaries.
import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses/api-response';
import { FilesService } from './files.service';

const filesService = new FilesService();

export async function getFileMetadata(req: Request, res: Response): Promise<void> {
  const data = await filesService.getMetadata(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

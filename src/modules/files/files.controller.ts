// Owns file metadata and storage integration boundaries.
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import { env } from '../../config/env';
import { sendSuccess } from '../../shared/responses/api-response';
import { FilesService } from './files.service';

const filesService = new FilesService();

export async function getFileMetadata(req: Request, res: Response): Promise<void> {
  const data = await filesService.getMetadata(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function getSignedFileUrl(req: Request, res: Response): Promise<void> {
  const url = await filesService.getSignedUrl(req.user!, String(req.params.id));
  sendSuccess(res, { url }, { requestId: req.requestId });
}

export async function downloadLocalFile(req: Request, res: Response): Promise<void> {
  const token = String(req.query.token);
  if (!token) {
    res.status(401).json({ error: 'Token is required' });
    return;
  }

  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as { key: string };
    const key = decoded.key;

    const targetPath = path.resolve(env.UPLOAD_DIR, key);
    const root = path.resolve(env.UPLOAD_DIR);

    if (!targetPath.startsWith(root)) {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }

    res.sendFile(targetPath);
  } catch {
    res.status(401).json({ error: 'Unauthorized or link expired' });
  }
}

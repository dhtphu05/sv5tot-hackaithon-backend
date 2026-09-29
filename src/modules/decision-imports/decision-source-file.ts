import { promises as fs } from 'node:fs';
import path from 'node:path';
import { FileStorageType } from '@prisma/client';
import { env } from '../../config/env';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { DocumentExtractionContent } from '../ai/openai-document-extraction';
import type { StorageService } from '../storage/storage.service';

type DecisionSourceFile = {
  storageType: FileStorageType;
  filePath: string;
  mimeType: string;
  workspaceId: string | null;
};

export async function buildDecisionDocumentContent(
  file: DecisionSourceFile,
  workspaceId: string,
  storage: StorageService,
): Promise<DocumentExtractionContent[]> {
  if (file.workspaceId !== workspaceId) {
    throw new AppError(404, ErrorCodes.FILE_NOT_FOUND, 'Decision source file not found');
  }
  if (file.mimeType !== 'application/pdf' && !['image/jpeg', 'image/png', 'image/webp'].includes(file.mimeType)) {
    throw new AppError(415, ErrorCodes.FILE_TYPE_NOT_ALLOWED, 'Decision extraction supports PDF and image files only');
  }

  const bytes = await readStoredFile(file, storage);
  if (file.mimeType === 'application/pdf') {
    return [{
      type: 'input_file',
      filename: 'decision-document.pdf',
      file_data: `data:application/pdf;base64,${bytes.toString('base64')}`,
    }];
  }
  return [{
    type: 'input_image',
    image_url: `data:${file.mimeType};base64,${bytes.toString('base64')}`,
    detail: 'auto',
  }];
}

async function readStoredFile(file: DecisionSourceFile, storage: StorageService): Promise<Buffer> {
  if (file.storageType === FileStorageType.local) {
    const root = path.resolve(env.UPLOAD_DIR);
    const filePath = path.resolve(root, file.filePath);
    const relative = path.relative(root, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new AppError(404, ErrorCodes.FILE_NOT_FOUND, 'Decision source file not found');
    }
    return fs.readFile(filePath);
  }

  const signedUrl = await storage.getSignedReadUrl(file.filePath, 300, file.storageType);
  const response = await fetch(signedUrl);
  if (!response.ok) {
    throw new AppError(502, ErrorCodes.STORAGE_ERROR, 'Decision source file download failed');
  }
  return Buffer.from(await response.arrayBuffer());
}

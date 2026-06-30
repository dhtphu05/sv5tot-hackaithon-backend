import { promises as fs } from 'node:fs';
import path from 'node:path';
import { env } from '../../config/env';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { StorageService, StoredFile } from './storage.interface';

export class LocalStorageService implements StorageService {
  constructor(private readonly uploadDir = env.UPLOAD_DIR) {}

  async saveFile(input: {
    buffer: Buffer;
    originalName: string;
    mimeType?: string;
    applicationId?: string;
    evidenceId?: string;
    directory?: string;
  }): Promise<StoredFile> {
    const directory =
      input.directory ??
      (input.applicationId && input.evidenceId
        ? path.join('evidences', input.applicationId, input.evidenceId)
        : 'misc');
    const safeFileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${sanitizeFileName(
      input.originalName,
    )}`;
    const targetDirectory = path.resolve(this.uploadDir, directory);
    const targetPath = path.join(targetDirectory, safeFileName);
    const root = path.resolve(this.uploadDir);

    if (!targetPath.startsWith(root)) {
      throw new AppError(400, ErrorCodes.STORAGE_ERROR, 'Invalid storage path');
    }

    await fs.mkdir(targetDirectory, { recursive: true });
    await fs.writeFile(targetPath, input.buffer);

    const key = path.join(directory, safeFileName);
    return {
      key,
      filePath: key,
      size: input.buffer.byteLength,
      mimeType: input.mimeType,
      publicUrl: this.getPublicUrl(key),
    };
  }

  async deleteFile(filePath: string): Promise<void> {
    const targetPath = path.resolve(this.uploadDir, filePath);
    const root = path.resolve(this.uploadDir);

    if (!targetPath.startsWith(root)) {
      throw new AppError(400, ErrorCodes.STORAGE_ERROR, 'Invalid storage path');
    }

    await fs.rm(targetPath, { force: true });
  }

  getPublicUrl(_filePath: string): string | null {
    return null;
  }
}

export function sanitizeFileName(fileName: string): string {
  const baseName = path.basename(fileName);
  return baseName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 160);
}

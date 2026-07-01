import { promises as fs } from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { env } from '../../../config/env';
import { AppError } from '../../../shared/errors/app-error';
import { ErrorCodes } from '../../../shared/errors/error-codes';
import type { StorageAdapter, UploadObjectParams } from '../storage.types';

export class LocalStorageAdapter implements StorageAdapter {
  private readonly uploadDir = env.UPLOAD_DIR;

  async uploadObject(params: UploadObjectParams): Promise<void> {
    const targetPath = path.resolve(this.uploadDir, params.key);
    const root = path.resolve(this.uploadDir);

    if (!targetPath.startsWith(root)) {
      throw new AppError(400, ErrorCodes.STORAGE_ERROR, 'Invalid storage path');
    }

    const targetDirectory = path.dirname(targetPath);
    await fs.mkdir(targetDirectory, { recursive: true });
    await fs.writeFile(targetPath, params.buffer);
  }

  async deleteObject(key: string): Promise<void> {
    const targetPath = path.resolve(this.uploadDir, key);
    const root = path.resolve(this.uploadDir);

    if (!targetPath.startsWith(root)) {
      throw new AppError(400, ErrorCodes.STORAGE_ERROR, 'Invalid storage path');
    }

    await fs.rm(targetPath, { force: true });
  }

  async getSignedReadUrl(key: string, expiresInSeconds = 300): Promise<string> {
    // Generate a secure short-lived token containing the key
    const token = jwt.sign({ key }, env.JWT_ACCESS_SECRET, { expiresIn: expiresInSeconds });
    return `http://localhost:${env.PORT}/api/files/download?token=${token}`;
  }
}

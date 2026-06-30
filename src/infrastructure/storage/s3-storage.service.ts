import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { StorageService, StoredFile } from './storage.interface';

export class S3StorageService implements StorageService {
  async saveFile(): Promise<StoredFile> {
    throw new AppError(501, ErrorCodes.NOT_IMPLEMENTED, 'S3 storage is not implemented yet');
  }

  async deleteFile(): Promise<void> {
    throw new AppError(501, ErrorCodes.NOT_IMPLEMENTED, 'S3 storage is not implemented yet');
  }

  getPublicUrl(): string | null {
    return null;
  }
}

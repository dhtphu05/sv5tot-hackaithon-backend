// Owns file metadata and storage integration boundaries.
import { Role } from '@prisma/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { FilesRepository } from './files.repository';
import { StorageService } from '../storage/storage.service';

export class FilesService {
  constructor(
    private readonly filesRepository = new FilesRepository(),
    private readonly storageService = new StorageService(),
  ) {}

  async getMetadata(user: AuthenticatedUser, fileId: string) {
    const file = await this.filesRepository.findById(fileId);
    if (!file) {
      throw new AppError(404, ErrorCodes.FILE_NOT_FOUND, 'File not found');
    }

    const canViewAll =
      user.role === Role.manager || user.role === Role.committee || user.role === Role.admin;

    if (file.ownerId !== user.id && !canViewAll) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'File belongs to another user');
    }

    return {
      id: file.id,
      originalName: file.originalName,
      mimeType: file.mimeType,
      fileSize: file.fileSize,
      publicUrl: file.publicUrl,
      createdAt: file.createdAt,
    };
  }

  async getSignedUrl(user: AuthenticatedUser, fileId: string): Promise<string> {
    const file = await this.filesRepository.findById(fileId);
    if (!file) {
      throw new AppError(404, ErrorCodes.FILE_NOT_FOUND, 'File not found');
    }

    const isOwner = file.ownerId === user.id;
    const isStaff =
      user.role === Role.officer ||
      user.role === Role.manager ||
      user.role === Role.committee ||
      user.role === Role.admin;

    if (!isOwner && !isStaff) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Access denied to this file');
    }

    return this.storageService.getSignedReadUrl(file.filePath, 300, file.storageType);
  }
}

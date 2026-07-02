// Owns file metadata and storage integration boundaries.
import { Role } from '@prisma/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { prisma } from '../../infrastructure/database/prisma';
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
    const canViewAll =
      user.role === Role.manager || user.role === Role.committee || user.role === Role.admin;
    const canOfficerView =
      user.role === Role.officer ? await this.canOfficerAccessEvidenceFile(user, file) : false;

    if (!isOwner && !canViewAll && !canOfficerView) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Access denied to this file');
    }

    return this.storageService.getSignedReadUrl(file.filePath, 300, file.storageType);
  }

  private async canOfficerAccessEvidenceFile(
    user: AuthenticatedUser,
    file: NonNullable<Awaited<ReturnType<FilesRepository['findById']>>>,
  ) {
    const evidenceLinks = file.evidenceFiles ?? [];
    if (!evidenceLinks.length) return false;

    for (const link of evidenceLinks) {
      const evidence = link.evidence;
      if (evidence.assignedOfficerId === user.id) return true;
      const tasks = evidence.application?.reviewTasks ?? [];
      if (
        tasks.some(
          (task) => task.assignedOfficerId === user.id && task.criterion === evidence.criterion,
        )
      ) {
        return true;
      }
      const spec = await prisma.officerSpecialization.findFirst({
        where: {
          officerId: user.id,
          criterion: evidence.criterion,
          isActive: true,
          OR: [
            { facultyScope: null },
            ...(evidence.application?.student.faculty
              ? [{ facultyScope: evidence.application.student.faculty }]
              : []),
          ],
        },
      });
      if (spec) return true;
    }

    return false;
  }
}

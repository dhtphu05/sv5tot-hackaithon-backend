import { FileStorageType } from '@prisma/client';
import { env } from '../../config/env';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import { pickSafeUser } from '../../shared/utils/pick-safe-user';
import { sanitizeFileName } from '../storage/storage.types';
import { StorageService } from '../storage/storage.service';
import { UsersRepository } from './users.repository';
import type { ListUsersQuery, UpdateMeInput } from './users.validation';

export class UsersService {
  constructor(
    private readonly usersRepository = new UsersRepository(),
    private readonly storageService = new StorageService(),
  ) {}

  async getMe(userId: string) {
    const user = await this.usersRepository.findById(userId);

    if (!user) {
      throw new AppError(404, ErrorCodes.NOT_FOUND, 'User not found');
    }

    return {
      ...pickSafeUser(user),
      officerSpecializations: user.officerSpecializations ?? [],
    };
  }

  async updateMe(userId: string, input: UpdateMeInput) {
    const user = await this.usersRepository.updateById(userId, input);
    return pickSafeUser(user);
  }

  async uploadAvatar(userId: string, file?: Express.Multer.File) {
    if (!file) {
      throw new AppError(400, ErrorCodes.FILE_UPLOAD_FAILED, 'Avatar file is required');
    }

    if (!file.mimetype.startsWith('image/')) {
      throw new AppError(400, ErrorCodes.FILE_TYPE_NOT_ALLOWED, 'Avatar must be an image file');
    }

    const maxAvatarSizeBytes = 5 * 1024 * 1024;
    if (file.size > maxAvatarSizeBytes) {
      throw new AppError(400, ErrorCodes.FILE_TOO_LARGE, 'Avatar image must be 5MB or smaller');
    }

    const timestamp = Date.now();
    const safeOriginalName = sanitizeFileName(file.originalname);
    const objectKey = `users/${userId}/avatar/${timestamp}-${safeOriginalName}`;

    await this.storageService.uploadObject({
      key: objectKey,
      buffer: file.buffer,
      contentType: file.mimetype,
    });

    const user = await this.usersRepository.createAvatarFileAndUpdateUser({
      userId,
      storageType: env.STORAGE_DRIVER === 'r2' ? FileStorageType.r2 : FileStorageType.local,
      filePath: objectKey,
      originalName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
    });

    return pickSafeUser(user);
  }

  async listUsers(query: ListUsersQuery) {
    const result = await this.usersRepository.list(query);
    const totalPages = Math.ceil(result.total / query.limit);

    return {
      users: result.users.map(pickSafeUser),
      pagination: {
        page: query.page,
        limit: query.limit,
        total: result.total,
        totalPages,
      },
    };
  }
}

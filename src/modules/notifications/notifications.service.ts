// Owns user notifications and read state.
import type { NotificationType, Prisma } from '@prisma/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import { NotificationsRepository } from './notifications.repository';
import type { ListNotificationsQuery } from './notifications.validation';

export class NotificationsService {
  constructor(private readonly notificationsRepository = new NotificationsRepository()) {}

  create(
    input: {
      userId: string;
      applicationId?: string | null;
      collectiveProfileId?: string | null;
      type: NotificationType;
      title: string;
      message: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    return this.notificationsRepository.create(input, tx);
  }

  async listForUser(userId: string, query: ListNotificationsQuery) {
    const [notifications, total] = await this.notificationsRepository.listForUser(userId, query);

    return {
      notifications,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async markRead(userId: string, notificationId: string) {
    const notification = await this.notificationsRepository.findById(notificationId);

    if (!notification) {
      throw new AppError(404, ErrorCodes.NOT_FOUND, 'Notification not found');
    }

    if (notification.userId !== userId) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Notification belongs to another user');
    }

    return this.notificationsRepository.markRead(notificationId);
  }
}

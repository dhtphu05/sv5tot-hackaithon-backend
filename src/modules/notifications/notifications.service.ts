import type { NotificationType, Prisma } from '@prisma/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import { NotificationsRepository } from './notifications.repository';
import type { ListNotificationsQuery } from './notifications.validation';
import { toNotificationSummary } from './notifications.dto';

export type CreateNotificationInput = {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  applicationId?: string | null;
  collectiveProfileId?: string | null;
  evidenceId?: string | null;
  reviewTaskId?: string | null;
  resolutionCaseId?: string | null;
  metadata?: unknown;
};

export class NotificationsService {
  constructor(private readonly notificationsRepository = new NotificationsRepository()) {}

  async create(input: CreateNotificationInput, tx?: Prisma.TransactionClient) {
    const data = {
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      applicationId: input.applicationId,
      collectiveProfileId: input.collectiveProfileId,
    };
    const created = await this.notificationsRepository.create(data, tx);
    return toNotificationSummary({
      ...created,
      evidenceId: input.evidenceId ?? null,
      reviewTaskId: input.reviewTaskId ?? null,
      resolutionCaseId: input.resolutionCaseId ?? null,
      metadata: input.metadata ?? null,
    });
  }

  async listForUser(userId: string, query: ListNotificationsQuery) {
    const [notifications, total] = await this.notificationsRepository.listForUser(userId, query);

    return {
      notifications: notifications.map(toNotificationSummary),
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

    const updated = await this.notificationsRepository.markRead(notificationId);
    return toNotificationSummary(updated);
  }

  async markAllRead(userId: string) {
    const result = await this.notificationsRepository.markAllRead(userId);
    return { updatedCount: result.count };
  }
}

const notificationsService = new NotificationsService();

export function createNotification(
  input: CreateNotificationInput,
  tx?: Prisma.TransactionClient,
) {
  return notificationsService.create(input, tx);
}

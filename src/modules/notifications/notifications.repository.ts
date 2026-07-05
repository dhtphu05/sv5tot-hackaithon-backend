import type { NotificationType, Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import type { ListNotificationsQuery } from './notifications.validation';

export type PersistNotificationInput = {
  userId: string;
  applicationId?: string | null;
  collectiveProfileId?: string | null;
  evidenceId?: string | null;
  reviewTaskId?: string | null;
  resolutionCaseId?: string | null;
  metadata?: unknown;
  type: NotificationType;
  title: string;
  message: string;
};

export class NotificationsRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  create(input: PersistNotificationInput, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.db;
    return client.notification.create({
      data: {
        userId: input.userId,
        applicationId: input.applicationId,
        collectiveProfileId: input.collectiveProfileId,
        evidenceId: input.evidenceId,
        reviewTaskId: input.reviewTaskId,
        resolutionCaseId: input.resolutionCaseId,
        metadata:
          input.metadata === undefined ? undefined : (input.metadata as Prisma.InputJsonValue),
        type: input.type,
        title: input.title,
        message: input.message,
      },
    });
  }

  listForUser(userId: string, query: ListNotificationsQuery) {
    const skip = (query.page - 1) * query.limit;
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.isRead === true ? { readAt: { not: null } } : {}),
      ...(query.isRead === false ? { readAt: null } : {}),
      ...(query.type ? { type: query.type } : {}),
    };

    return this.db.$transaction([
      this.db.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.limit,
      }),
      this.db.notification.count({ where }),
    ]);
  }

  findById(id: string) {
    return this.db.notification.findUnique({ where: { id } });
  }

  markRead(id: string) {
    return this.db.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }

  markAllRead(userId: string) {
    return this.db.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}

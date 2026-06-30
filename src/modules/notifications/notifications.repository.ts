import type { NotificationType, Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import type { ListNotificationsQuery } from './notifications.validation';

export class NotificationsRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

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
    const client = tx ?? this.db;
    return client.notification.create({ data: input });
  }

  listForUser(userId: string, query: ListNotificationsQuery) {
    const skip = (query.page - 1) * query.limit;
    return this.db.$transaction([
      this.db.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.limit,
      }),
      this.db.notification.count({ where: { userId } }),
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
}

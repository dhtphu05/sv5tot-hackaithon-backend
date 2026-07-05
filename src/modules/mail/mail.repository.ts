import { EmailOutboxStatus, Prisma, type EmailOutbox, type PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';

export type CreateEmailOutboxInput = {
  recipientEmail: string;
  recipientName?: string | null;
  subject: string;
  templateKey: string;
  payloadJson?: Prisma.InputJsonValue;
  maxAttempts: number;
  relatedUserId?: string | null;
  applicationId?: string | null;
  notificationId?: string | null;
  dedupeKey: string;
};

export class MailRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  async createIfNotExists(input: CreateEmailOutboxInput, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.db;
    try {
      const email = await client.emailOutbox.create({
        data: {
          recipientEmail: input.recipientEmail,
          recipientName: input.recipientName ?? null,
          subject: input.subject,
          templateKey: input.templateKey,
          payloadJson: input.payloadJson ?? Prisma.JsonNull,
          maxAttempts: input.maxAttempts,
          relatedUserId: input.relatedUserId ?? null,
          applicationId: input.applicationId ?? null,
          notificationId: input.notificationId ?? null,
          dedupeKey: input.dedupeKey,
        },
      });
      return { email, created: true };
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
      const existing = await client.emailOutbox.findUniqueOrThrow({
        where: { dedupeKey: input.dedupeKey },
      });
      return { email: existing, created: false };
    }
  }

  findNextDue(now = new Date()) {
    return this.db.emailOutbox.findFirst({
      where: {
        OR: [
          {
            status: EmailOutboxStatus.queued,
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
          {
            status: EmailOutboxStatus.failed,
            nextAttemptAt: { lte: now },
          },
        ],
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
    });
  }

  markSending(id: string) {
    return this.db.emailOutbox.update({
      where: { id },
      data: {
        status: EmailOutboxStatus.sending,
        attempts: { increment: 1 },
        lastError: null,
      },
    });
  }

  markSent(id: string, providerMessageId: string) {
    return this.db.emailOutbox.update({
      where: { id },
      data: {
        status: EmailOutboxStatus.sent,
        providerMessageId,
        lastError: null,
        nextAttemptAt: null,
        sentAt: new Date(),
      },
    });
  }

  markFailed(id: string, input: { lastError: string; nextAttemptAt: Date | null }) {
    return this.db.emailOutbox.update({
      where: { id },
      data: {
        status: EmailOutboxStatus.failed,
        lastError: input.lastError,
        nextAttemptAt: input.nextAttemptAt,
      },
    });
  }

  findById(id: string) {
    return this.db.emailOutbox.findUnique({ where: { id } });
  }

  resetFailed(id: string) {
    return this.db.emailOutbox.update({
      where: { id },
      data: {
        status: EmailOutboxStatus.queued,
        lastError: null,
        nextAttemptAt: null,
      },
    });
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export type EmailOutboxRecord = EmailOutbox;

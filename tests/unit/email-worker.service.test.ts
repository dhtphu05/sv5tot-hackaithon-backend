import { EmailOutboxStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/infrastructure/database/prisma';
import { EmailWorkerService } from '../../src/modules/mail/email-worker.service';

vi.mock('../../src/infrastructure/database/prisma', () => ({
  prisma: {
    reviewTask: {
      findMany: vi.fn(),
    },
  },
}));

const baseEmail = {
  id: 'email-1',
  recipientEmail: 'student@dut.udn.vn',
  recipientName: 'Student',
  subject: '[5TOT] Test',
  templateKey: 'application_submitted',
  payloadJson: null,
  status: EmailOutboxStatus.queued,
  attempts: 0,
  maxAttempts: 3,
  nextAttemptAt: null,
  providerMessageId: null,
  lastError: null,
  relatedUserId: 'user-1',
  applicationId: 'app-1',
  notificationId: 'notification-1',
  dedupeKey: 'dedupe-1',
  createdAt: new Date('2026-07-05T00:00:00.000Z'),
  updatedAt: new Date('2026-07-05T00:00:00.000Z'),
  sentAt: null,
};

describe('EmailWorkerService', () => {
  it('sends due email and marks it sent', async () => {
    const sentEmail = {
      ...baseEmail,
      status: EmailOutboxStatus.sent,
      providerMessageId: 'provider-message-1',
      sentAt: new Date('2026-07-05T00:01:00.000Z'),
    };
    const repository = {
      findNextDue: vi.fn().mockResolvedValue(baseEmail),
      markSending: vi.fn().mockResolvedValue({ ...baseEmail, status: EmailOutboxStatus.sending, attempts: 1 }),
      markSent: vi.fn().mockResolvedValue(sentEmail),
    };
    const mailService = {
      send: vi.fn().mockResolvedValue({ provider: 'console', messageId: 'provider-message-1' }),
    };
    const outboxService = {
      renderStoredPayload: vi.fn().mockReturnValue({
        subject: baseEmail.subject,
        html: '<p>hello</p>',
        text: 'hello',
      }),
    };
    const writeAudit = vi.fn().mockResolvedValue({});
    const service = new EmailWorkerService(
      repository as never,
      mailService as never,
      outboxService as never,
      writeAudit,
      false,
    );

    const result = await service.runTick(new Date('2026-07-05T00:00:00.000Z'));

    expect(result.processed).toBe(1);
    expect(mailService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: baseEmail.recipientEmail,
        subject: baseEmail.subject,
      }),
    );
    expect(repository.markSent).toHaveBeenCalledWith(baseEmail.id, 'provider-message-1');
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'EMAIL_SENT',
        targetType: 'email_outbox',
      }),
    );
  });

  it('marks failed email for retry when provider fails', async () => {
    const sendingEmail = {
      ...baseEmail,
      status: EmailOutboxStatus.sending,
      attempts: 1,
      maxAttempts: 3,
    };
    const repository = {
      findNextDue: vi.fn().mockResolvedValue(baseEmail),
      markSending: vi.fn().mockResolvedValue(sendingEmail),
      markFailed: vi.fn().mockResolvedValue({
        ...sendingEmail,
        status: EmailOutboxStatus.failed,
        lastError: 'SMTP down',
      }),
    };
    const mailService = {
      send: vi.fn().mockRejectedValue(new Error('SMTP down')),
    };
    const outboxService = {
      renderStoredPayload: vi.fn().mockReturnValue({
        subject: baseEmail.subject,
        html: '<p>hello</p>',
        text: 'hello',
      }),
    };
    const writeAudit = vi.fn().mockResolvedValue({});
    const service = new EmailWorkerService(
      repository as never,
      mailService as never,
      outboxService as never,
      writeAudit,
      false,
    );

    const result = await service.runTick(new Date('2026-07-05T00:00:00.000Z'));

    expect(result.processed).toBe(1);
    expect(repository.markFailed).toHaveBeenCalledWith(
      baseEmail.id,
      expect.objectContaining({
        lastError: 'SMTP down',
        nextAttemptAt: expect.any(Date),
      }),
    );
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'EMAIL_FAILED',
        targetType: 'email_outbox',
      }),
    );
  });

  it('queues deadline reminder with stable milestone dedupe key', async () => {
    vi.mocked(prisma.reviewTask.findMany).mockResolvedValue([
      {
        id: 'review-task-1',
        criterion: 'academic',
        dueDate: new Date('2026-07-06T12:00:00.000Z'),
        supplementRequestJson: {
          requestedFields: ['Bảng điểm xác nhận'],
          reason: 'Cần làm rõ minh chứng học tập.',
        },
        application: {
          id: 'app-1',
          studentId: 'student-1',
          schoolYear: '2025-2026',
          targetLevel: 'school',
          student: {
            email: 'student@dut.udn.vn',
            fullName: 'Nguyễn Văn A',
          },
        },
      },
    ] as never);
    const repository = {
      findNextDue: vi.fn().mockResolvedValue(null),
    };
    const outboxService = {
      enqueue: vi.fn().mockResolvedValue({ id: 'email-1', created: true }),
    };
    const service = new EmailWorkerService(
      repository as never,
      { send: vi.fn() } as never,
      outboxService as never,
      vi.fn().mockResolvedValue({}),
      true,
    );

    const result = await service.runTick(new Date('2026-07-05T12:00:00.000Z'));

    expect(result.remindersQueued).toBe(1);
    expect(outboxService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        templateKey: 'supplement_deadline_reminder',
        dedupeKey: 'supplement_deadline_reminder:review-task-1:D-1',
        payload: expect.objectContaining({
          reminderWindow: 'D-1',
          criterionName: 'academic',
          supplementSummary: expect.stringContaining('Bảng điểm xác nhận'),
        }),
      }),
    );
  });
});

import { EmailOutboxStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { EmailWorkerService } from '../../src/modules/mail/email-worker.service';

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
});

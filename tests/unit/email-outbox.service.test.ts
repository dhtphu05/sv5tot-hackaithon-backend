import { EmailOutboxStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { EmailOutboxService } from '../../src/modules/mail/email-outbox.service';
import { MailTemplateService } from '../../src/modules/mail/mail-template.service';

describe('EmailOutboxService', () => {
  it('enqueues rendered email and writes audit when created', async () => {
    const email = {
      id: '2e2031e8-bd75-4d93-9b7a-78a8f31f4e22',
      status: EmailOutboxStatus.queued,
    };
    const repository = {
      createIfNotExists: vi.fn().mockResolvedValue({ email, created: true }),
    };
    const tx = {
      auditLog: {
        create: vi.fn().mockResolvedValue({}),
      },
    };
    const service = new EmailOutboxService(repository as never, new MailTemplateService());

    const result = await service.enqueue(
      {
        recipientEmail: 'student@dut.udn.vn',
        recipientName: 'Student',
        relatedUserId: 'user-1',
        applicationId: 'app-1',
        notificationId: 'notification-1',
        templateKey: 'application_submitted',
        payload: {
          recipientName: 'Student',
          applicationId: 'app-1',
          schoolYear: '2025-2026',
          targetLevel: 'school',
        },
        dedupeKey: 'application_submitted:app-1:v1',
      },
      tx as never,
    );

    expect(result).toMatchObject({ id: email.id, created: true });
    expect(repository.createIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientEmail: 'student@dut.udn.vn',
        templateKey: 'application_submitted',
        subject: '[5TOT] Ho so da duoc nop',
        dedupeKey: 'application_submitted:app-1:v1',
      }),
      tx,
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'EMAIL_QUEUED',
          targetType: 'email_outbox',
          targetId: email.id,
        }),
      }),
    );
  });

  it('does not write duplicate audit when dedupe returns existing email', async () => {
    const repository = {
      createIfNotExists: vi.fn().mockResolvedValue({
        email: {
          id: 'existing-email',
          status: EmailOutboxStatus.queued,
        },
        created: false,
      }),
    };
    const tx = {
      auditLog: {
        create: vi.fn().mockResolvedValue({}),
      },
    };
    const service = new EmailOutboxService(repository as never, new MailTemplateService());

    const result = await service.enqueue(
      {
        recipientEmail: 'student@dut.udn.vn',
        templateKey: 'application_submitted',
        payload: { applicationId: 'app-1' },
        dedupeKey: 'application_submitted:app-1:v1',
      },
      tx as never,
    );

    expect(result).toMatchObject({ id: 'existing-email', created: false });
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});

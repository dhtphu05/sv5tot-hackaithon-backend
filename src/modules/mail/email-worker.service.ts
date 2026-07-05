import { ApplicationStatus, ReviewTaskStatus } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../infrastructure/database/prisma';
import { MailService } from '../../infrastructure/mail/mail.service';
import { createApplicationAudit } from '../applications/application.helpers';
import { buildEmailDedupeKey, EmailOutboxService } from './email-outbox.service';
import { MailRepository, type EmailOutboxRecord } from './mail.repository';

type EmailWorkerAuditInput = Parameters<typeof createApplicationAudit>[1];

export class EmailWorkerService {
  constructor(
    private readonly repository = new MailRepository(),
    private readonly mailService = new MailService(),
    private readonly outboxService = new EmailOutboxService(),
    private readonly writeAudit: (input: EmailWorkerAuditInput) => Promise<unknown> = (input) =>
      createApplicationAudit(prisma, input),
    private readonly deadlineReminderEnabled = true,
  ) {}

  async runTick(now = new Date()) {
    const remindersQueued = this.deadlineReminderEnabled
      ? await this.enqueueDeadlineReminders(now)
      : 0;
    const email = await this.repository.findNextDue(now);
    if (!email) {
      return { processed: 0, email: null, remindersQueued };
    }

    const processed = await this.processEmail(email);
    return { processed: 1, email: processed, remindersQueued };
  }

  async retry(emailOutboxId: string) {
    const email = await this.repository.findById(emailOutboxId);
    if (!email) return null;
    return this.repository.resetFailed(email.id);
  }

  private async processEmail(email: EmailOutboxRecord) {
    const sending = await this.repository.markSending(email.id);
    const rendered = this.outboxService.renderStoredPayload(sending);

    try {
      const result = await this.mailService.send({
        to: sending.recipientEmail,
        toName: sending.recipientName,
        subject: sending.subject,
        html: rendered.html,
        text: rendered.text,
      });
      const sent = await this.repository.markSent(sending.id, result.messageId);
      await this.writeAudit({
        action: 'EMAIL_SENT',
        targetType: 'email_outbox',
        targetId: sent.id,
        applicationId: sent.applicationId,
        afterStateJson: {
          recipientEmail: sent.recipientEmail,
          templateKey: sent.templateKey,
          emailOutboxId: sent.id,
          providerMessageId: result.messageId,
          status: sent.status,
        },
      });
      return sent;
    } catch (error) {
      const lastError = error instanceof Error ? error.message : 'Unknown email failure';
      const nextAttemptAt =
        sending.attempts >= sending.maxAttempts
          ? null
          : new Date(Date.now() + retryDelayMs(sending.attempts));
      const failed = await this.repository.markFailed(sending.id, {
        lastError,
        nextAttemptAt,
      });
      await this.writeAudit({
        action: 'EMAIL_FAILED',
        targetType: 'email_outbox',
        targetId: failed.id,
        applicationId: failed.applicationId,
        afterStateJson: {
          recipientEmail: failed.recipientEmail,
          templateKey: failed.templateKey,
          emailOutboxId: failed.id,
          status: failed.status,
          attempts: failed.attempts,
          maxAttempts: failed.maxAttempts,
          nextAttemptAt,
          error: lastError,
        },
      });
      return failed;
    }
  }

  private async enqueueDeadlineReminders(now: Date) {
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const tasks = await prisma.reviewTask.findMany({
      where: {
        status: ReviewTaskStatus.supplement_required,
        dueDate: { not: null, lte: threeDaysFromNow },
        application: {
          status: ApplicationStatus.supplement_required,
        },
      },
      include: {
        application: { include: { student: true } },
      },
      take: 50,
    });

    let queued = 0;
    for (const task of tasks) {
      if (!task.application || !task.dueDate) continue;
      const window = reminderWindow(task.dueDate, now);
      const payload = {
        recipientName: task.application.student.fullName,
        applicationId: task.application.id,
        schoolYear: task.application.schoolYear,
        targetLevel: task.application.targetLevel,
        criterion: task.criterion,
        deadline: task.dueDate.toISOString(),
        window,
      };
      const result = await this.outboxService.enqueue({
        recipientEmail: task.application.student.email,
        recipientName: task.application.student.fullName,
        relatedUserId: task.application.studentId,
        applicationId: task.application.id,
        templateKey: 'supplement_deadline_reminder',
        payload,
        dedupeKey: buildEmailDedupeKey('supplement_deadline_reminder', {
          reviewTaskId: task.id,
          dueDate: task.dueDate.toISOString(),
          window,
        }),
      });
      if (result.created) queued += 1;
    }

    return queued;
  }
}

function retryDelayMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  return env.MAIL_RETRY_BASE_SECONDS * 1000 * 2 ** exponent;
}

function reminderWindow(dueDate: Date, now: Date): string {
  const diffMs = dueDate.getTime() - now.getTime();
  if (diffMs < 0) return 'overdue';
  if (diffMs <= 24 * 60 * 60 * 1000) return '1d';
  return '3d';
}

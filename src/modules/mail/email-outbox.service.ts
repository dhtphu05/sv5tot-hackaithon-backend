import { createHash } from 'node:crypto';
import { Prisma, type Role } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../infrastructure/database/prisma';
import { createApplicationAudit } from '../applications/application.helpers';
import { MailRepository } from './mail.repository';
import {
  MailTemplateService,
  type MailTemplateKey,
  type RenderedMailTemplate,
} from './mail-template.service';

export type EnqueueEmailInput = {
  recipientEmail: string;
  recipientName?: string | null;
  relatedUserId?: string | null;
  applicationId?: string | null;
  notificationId?: string | null;
  templateKey: MailTemplateKey;
  payload: Record<string, unknown>;
  dedupeKey: string;
  actorId?: string | null;
  actorRole?: Role | null;
};

export type EnqueueEmailResult = {
  id: string;
  created: boolean;
  subject: string;
};

export class EmailOutboxService {
  constructor(
    private readonly repository = new MailRepository(),
    private readonly templateService = new MailTemplateService(),
  ) {}

  async enqueue(input: EnqueueEmailInput, tx?: Prisma.TransactionClient): Promise<EnqueueEmailResult> {
    const rendered = this.templateService.render({
      templateKey: input.templateKey,
      payload: input.payload,
    });

    const { email, created } = await this.repository.createIfNotExists(
      {
        recipientEmail: input.recipientEmail,
        recipientName: input.recipientName,
        subject: rendered.subject,
        templateKey: input.templateKey,
        payloadJson: toJsonPayload({
          ...input.payload,
          renderedText: rendered.text,
          renderedHtml: rendered.html,
        }),
        maxAttempts: env.MAIL_MAX_ATTEMPTS,
        relatedUserId: input.relatedUserId,
        applicationId: input.applicationId,
        notificationId: input.notificationId,
        dedupeKey: input.dedupeKey,
      },
      tx,
    );

    if (created) {
      await createApplicationAudit(tx ?? prisma, {
        actorId: input.actorId ?? undefined,
        actorRole: input.actorRole ?? undefined,
        action: 'EMAIL_QUEUED',
        targetType: 'email_outbox',
        targetId: email.id,
        applicationId: input.applicationId,
        afterStateJson: {
          recipientEmail: input.recipientEmail,
          templateKey: input.templateKey,
          emailOutboxId: email.id,
          status: email.status,
        },
      });
    }

    return {
      id: email.id,
      created,
      subject: rendered.subject,
    };
  }

  renderStoredPayload(email: {
    templateKey: string;
    payloadJson: Prisma.JsonValue | null;
  }): RenderedMailTemplate {
    const payload = normalizeStoredPayload(email.payloadJson);
    if (payload.renderedHtml && payload.renderedText) {
      return {
        subject: String(payload.subject ?? ''),
        html: String(payload.renderedHtml),
        text: String(payload.renderedText),
      };
    }
    return this.templateService.render({
      templateKey: email.templateKey as MailTemplateKey,
      payload,
    });
  }
}

export function buildEmailDedupeKey(prefix: string, payload: unknown): string {
  const hash = createHash('sha256')
    .update(JSON.stringify(payload, stableJsonReplacer))
    .digest('hex')
    .slice(0, 32);
  return `${prefix}:${hash}`;
}

function toJsonPayload(payload: Record<string, unknown>): Prisma.InputJsonValue {
  return payload as Prisma.InputJsonValue;
}

function normalizeStoredPayload(value: Prisma.JsonValue | null): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function stableJsonReplacer(_key: string, value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = (value as Record<string, unknown>)[key];
      return acc;
    }, {});
}

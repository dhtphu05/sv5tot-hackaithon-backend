import nodemailer from 'nodemailer';
import { env } from '../../config/env';
import { logger } from '../../config/logger';

export type SendMailInput = {
  to: string;
  toName?: string | null;
  subject: string;
  html: string;
  text: string;
};

export type SendMailResult = {
  provider: 'console' | 'smtp';
  messageId: string;
};

export class MailService {
  async send(input: SendMailInput): Promise<SendMailResult> {
    if (!env.MAIL_ENABLED || env.MAIL_PROVIDER === 'console') {
      logger.info(
        {
          provider: 'console',
          to: input.to,
          toName: input.toName,
          subject: input.subject,
          text: input.text,
        },
        'Email rendered by console provider',
      );

      return {
        provider: 'console',
        messageId: `console-${Date.now()}`,
      };
    }

    const transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASSWORD,
      },
    });

    const info = await transporter.sendMail({
      from: formatAddress(env.MAIL_FROM_NAME, env.MAIL_FROM_ADDRESS),
      to: formatAddress(input.toName, input.to),
      subject: input.subject,
      html: input.html,
      text: input.text,
    });

    return {
      provider: 'smtp',
      messageId: info.messageId,
    };
  }
}

function formatAddress(name: string | null | undefined, email: string): string {
  const safeName = name?.trim();
  if (!safeName) return email;
  return `"${safeName.replace(/"/g, '\\"')}" <${email}>`;
}

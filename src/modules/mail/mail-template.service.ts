import { env } from '../../config/env';

export type MailTemplateKey =
  | 'application_submitted'
  | 'supplement_requested'
  | 'supplement_deadline_reminder'
  | 'application_status_updated'
  | 'application_result_announced';

export type RenderMailTemplateInput = {
  templateKey: MailTemplateKey;
  payload: Record<string, unknown>;
};

export type RenderedMailTemplate = {
  subject: string;
  html: string;
  text: string;
};

export class MailTemplateService {
  render(input: RenderMailTemplateInput): RenderedMailTemplate {
    const data = normalizePayload(input.payload);
    const appLink = buildAppLink(data.applicationId);

    if (input.templateKey === 'application_submitted') {
      return buildTemplate({
        subject: '[5TOT] Ho so da duoc nop',
        greetingName: data.recipientName,
        lines: [
          'He thong da ghi nhan ho so Sinh vien 5 tot cua ban.',
          `Ma ho so: ${data.applicationId ?? 'N/A'}.`,
          `Nam hoc: ${data.schoolYear ?? 'N/A'}.`,
          `Cap dang ky: ${data.targetLevel ?? 'N/A'}.`,
          'Ho so da chuyen sang trang thai dang xet duyet.',
        ],
        appLink,
      });
    }

    if (input.templateKey === 'supplement_requested') {
      return buildTemplate({
        subject: '[5TOT] Can bo sung minh chung',
        greetingName: data.recipientName,
        lines: [
          'Can bo xet duyet da yeu cau ban bo sung minh chung cho ho so.',
          `Ma ho so: ${data.applicationId ?? 'N/A'}.`,
          `Tieu chi: ${data.criterion ?? 'N/A'}.`,
          data.deadline ? `Han bo sung: ${data.deadline}.` : 'Han bo sung: xem chi tiet trong he thong.',
          data.reason ? `Tom tat yeu cau: ${data.reason}.` : 'Vui long xem chi tiet yeu cau trong he thong.',
        ],
        appLink,
      });
    }

    if (input.templateKey === 'supplement_deadline_reminder') {
      return buildTemplate({
        subject: '[5TOT] Sap het han bo sung minh chung',
        greetingName: data.recipientName,
        lines: [
          'Ho so cua ban co yeu cau bo sung minh chung sap den han.',
          `Ma ho so: ${data.applicationId ?? 'N/A'}.`,
          `Tieu chi: ${data.criterion ?? 'N/A'}.`,
          data.deadline ? `Han bo sung: ${data.deadline}.` : 'Han bo sung: xem chi tiet trong he thong.',
          'Vui long dang nhap he thong de cap nhat minh chung.',
        ],
        appLink,
      });
    }

    if (input.templateKey === 'application_status_updated') {
      return buildTemplate({
        subject: '[5TOT] Ho so co cap nhat trang thai',
        greetingName: data.recipientName,
        lines: [
          'Ho so Sinh vien 5 tot cua ban co cap nhat quan trong.',
          `Ma ho so: ${data.applicationId ?? 'N/A'}.`,
          `Trang thai moi: ${data.status ?? 'N/A'}.`,
          data.context ? `Ngu canh: ${data.context}.` : 'Vui long xem chi tiet trong he thong.',
        ],
        appLink,
      });
    }

    return buildTemplate({
      subject: '[5TOT] Ho so da co ket qua',
      greetingName: data.recipientName,
      lines: [
        'Ho so Sinh vien 5 tot cua ban da co ket qua xet duyet.',
        `Ma ho so: ${data.applicationId ?? 'N/A'}.`,
        `Ket qua: ${data.finalStatus ?? 'N/A'}.`,
        data.finalLevel ? `Cap dat duoc: ${data.finalLevel}.` : 'Cap dat duoc: khong co.',
        'Email nay chi thong bao tom tat. Vui long dang nhap he thong de xem chi tiet.',
      ],
      appLink,
    });
  }
}

function buildTemplate(input: {
  subject: string;
  greetingName?: string;
  lines: string[];
  appLink: string;
}): RenderedMailTemplate {
  const greeting = `Xin chao ${input.greetingName || 'ban'},`;
  const allLines = [greeting, ...input.lines, `Xem chi tiet tai: ${input.appLink}`];
  const text = allLines.join('\n\n');
  const htmlLines = allLines.map((line) => `<p>${escapeHtml(line)}</p>`).join('');

  return {
    subject: input.subject,
    text,
    html: [
      '<!doctype html>',
      '<html>',
      '<body>',
      htmlLines,
      '<p>Tran trong,<br/>He thong 5TOT</p>',
      '</body>',
      '</html>',
    ].join(''),
  };
}

function normalizePayload(payload: Record<string, unknown>) {
  return {
    recipientName: toStringValue(payload.recipientName),
    applicationId: toStringValue(payload.applicationId),
    schoolYear: toStringValue(payload.schoolYear),
    targetLevel: toStringValue(payload.targetLevel),
    criterion: toStringValue(payload.criterion),
    deadline: toStringValue(payload.deadline),
    reason: toStringValue(payload.reason),
    status: toStringValue(payload.status),
    context: toStringValue(payload.context),
    finalStatus: toStringValue(payload.finalStatus),
    finalLevel: toStringValue(payload.finalLevel),
  };
}

function toStringValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function buildAppLink(applicationId?: string): string {
  const base = env.APP_BASE_URL.replace(/\/$/, '');
  if (!applicationId) return `${base}/app`;
  return `${base}/app?applicationId=${encodeURIComponent(applicationId)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

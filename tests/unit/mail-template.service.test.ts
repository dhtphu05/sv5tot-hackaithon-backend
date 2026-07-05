import { describe, expect, it } from 'vitest';
import { MailTemplateService } from '../../src/modules/mail/mail-template.service';

describe('MailTemplateService', () => {
  it('renders supplement email without sensitive evidence details', () => {
    const service = new MailTemplateService();

    const rendered = service.render({
      templateKey: 'supplement_requested',
      payload: {
        recipientName: 'Nguyen Van A',
        applicationId: 'app-1',
        criterion: 'academic',
        deadline: '2026-07-10T00:00:00.000Z',
        reason: 'Can bo sung bang diem co xac nhan.',
        ocrText: 'Sensitive OCR content must not appear.',
        evidenceFileName: 'private-proof.pdf',
        rawEvidenceUrl: 'https://private.example/proof.pdf',
      },
    });

    expect(rendered.subject).toContain('Can bo sung');
    expect(rendered.text).toContain('Nguyen Van A');
    expect(rendered.text).toContain('academic');
    expect(rendered.text).not.toContain('Sensitive OCR content');
    expect(rendered.text).not.toContain('private-proof.pdf');
    expect(rendered.text).not.toContain('private.example');
    expect(rendered.html).not.toContain('Sensitive OCR content');
  });
});

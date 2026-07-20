import { describe, expect, it } from 'vitest';
import { MailTemplateService, type MailTemplateKey } from '../../src/modules/mail/mail-template.service';

describe('MailTemplateService', () => {
  it('renders official HTML and readable text fallback for application_submitted', () => {
    const service = new MailTemplateService();

    const rendered = service.render({
      templateKey: 'application_submitted',
      payload: {
        studentName: 'Nguyễn Văn A',
        applicationCode: 'app-1',
        schoolYear: '2025-2026',
        targetLevel: 'school',
        applicationUrl: 'https://5tot.test/app?applicationId=app-1',
      },
    });

    expect(rendered.subject).toBe(
      '[5TOT.2025-2026] XÁC NHẬN TIẾP NHẬN HỒ SƠ SINH VIÊN 5 TỐT',
    );
    expect(rendered.text).toContain('Thân chào bạn Nguyễn Văn A,');
    expect(rendered.text).toContain('Hồ sơ Sinh viên 5 tốt của bạn đã được tiếp nhận'.toUpperCase());
    expect(rendered.text).toContain('- Cấp xét đăng ký: cấp Trường');
    expect(rendered.html).toContain("font-family:'Times New Roman', Arial, sans-serif");
    expect(rendered.html).toContain('color:#d93025');
    expect(rendered.html).toContain('color:#0b57d0');
    expect(rendered.html).toContain('border-top:1px solid #333333');
    expect(rendered.html).toContain('href="https://5tot.test/app?applicationId=app-1"');
    expect(rendered.text).not.toMatch(/\b(undefined|null|NaN)\b/);
    expect(rendered.html).not.toMatch(/\b(undefined|null|NaN)\b/);
  });

  it('renders resubmission and supplement contexts with Vietnamese labels', () => {
    const service = new MailTemplateService();

    const resubmitted = service.render({
      templateKey: 'application_resubmitted',
      payload: {
        studentName: 'Nguyễn Văn A',
        applicationCode: 'app-1',
        schoolYear: '2025-2026',
        criterionName: 'academic',
      },
    });
    const reopened = service.render({
      templateKey: 'supplement_requested',
      payload: {
        studentName: 'Nguyễn Văn A',
        applicationCode: 'app-1',
        schoolYear: '2025-2026',
        criterionName: 'volunteer',
        deadline: '2026-07-10T00:00:00.000Z',
        supplementSummary: 'Bổ sung giấy xác nhận hoạt động.',
        reason: 'Cần làm rõ minh chứng.',
        contextType: 'reopened_by_manager',
      },
    });

    expect(resubmitted.subject).toBe(
      '[5TOT.2025-2026] XÁC NHẬN TIẾP NHẬN PHẦN BỔ SUNG HỒ SƠ',
    );
    expect(resubmitted.text).toContain('Học tập tốt');
    expect(reopened.subject).toBe(
      '[5TOT.2025-2026] HỒ SƠ ĐÃ ĐƯỢC MỞ ĐỂ BỔ SUNG MINH CHỨNG',
    );
    expect(reopened.text).toContain('Tình nguyện tốt');
    expect(reopened.text).toContain('Bổ sung giấy xác nhận hoạt động.');
  });

  it('renders supplement email with action details and without sensitive evidence fields', () => {
    const service = new MailTemplateService();

    const rendered = service.render({
      templateKey: 'supplement_requested',
      payload: {
        studentName: 'Nguyễn Văn A',
        applicationCode: 'app-1',
        schoolYear: '2025-2026',
        criterionName: 'academic',
        deadline: '2026-07-10T00:00:00.000Z',
        reason: 'Cần bổ sung bảng điểm có xác nhận.',
        supplementSummary: 'Bổ sung bảng điểm học kỳ gần nhất.',
        supplementUrl: 'https://5tot.test/app/supplement',
        ocrText: 'Sensitive OCR content must not appear.',
        evidenceFileName: 'private-proof.pdf',
        rawEvidenceUrl: 'https://private.example/proof.pdf',
      },
    });

    expect(rendered.subject).toBe(
      '[5TOT.2025-2026] YÊU CẦU BỔ SUNG MINH CHỨNG HỒ SƠ SINH VIÊN 5 TỐT',
    );
    expect(rendered.text).toContain('Học tập tốt');
    expect(rendered.text).toContain('Cần bổ sung bảng điểm có xác nhận.');
    expect(rendered.text).toContain('Bổ sung minh chứng tại: https://5tot.test/app/supplement');
    expect(rendered.text).not.toContain('Sensitive OCR content');
    expect(rendered.text).not.toContain('private-proof.pdf');
    expect(rendered.html).not.toContain('private.example');
  });

  it('renders rejection and final result with soft wording and no raw enums', () => {
    const service = new MailTemplateService();

    const rejected = service.render({
      templateKey: 'application_rejected',
      payload: {
        studentName: 'Nguyễn Văn A',
        applicationCode: 'app-1',
        schoolYear: '2025-2026',
        status: 'rejected',
        targetLevel: 'school',
        reason: 'Tiêu chí học tập cần thêm xác nhận.',
      },
    });
    const achieved = service.render({
      templateKey: 'application_result_announced',
      payload: {
        studentName: 'Nguyễn Văn A',
        applicationCode: 'app-1',
        schoolYear: '2025-2026',
        finalStatus: 'partially_passed',
        finalLevel: 'school',
      },
    });
    const notAchieved = service.render({
      templateKey: 'application_result_announced',
      payload: {
        studentName: 'Nguyễn Văn A',
        applicationCode: 'app-1',
        schoolYear: '2025-2026',
        finalStatus: 'failed',
        reason: 'Chưa đủ minh chứng.',
      },
    });

    expect(rejected.text).toContain('chưa đủ điều kiện ở đợt xét');
    expect(rejected.text).not.toMatch(/bị loại|reject|fail|rejected/i);
    expect(achieved.text).toContain('Chúc mừng bạn đã đạt danh hiệu Sinh viên 5 tốt cấp Trường');
    expect(achieved.text).not.toContain('school');
    expect(notAchieved.text).toContain('Chưa đạt danh hiệu Sinh viên 5 tốt ở đợt xét này');
    expect(notAchieved.text).not.toMatch(/failed|rejected|school|undefined|null|NaN/i);
  });

  it('renders deadline reminder variants and fallback values', () => {
    const service = new MailTemplateService();

    const beforeDue = service.render({
      templateKey: 'supplement_deadline_reminder',
      payload: {
        reminderWindow: 'D-1',
        criterion: 'integration',
      },
    });
    const overdue = service.render({
      templateKey: 'supplement_deadline_reminder',
      payload: {
        reminderWindow: 'OVERDUE',
      },
    });

    expect(beforeDue.subject).toBe('[5TOT] NHẮC HẠN BỔ SUNG HỒ SƠ SINH VIÊN 5 TỐT');
    expect(beforeDue.text).toContain('Hội nhập tốt');
    expect(beforeDue.text).toContain('Theo thông báo trên hệ thống');
    expect(overdue.subject).toBe('[5TOT] HỒ SƠ ĐÃ QUÁ HẠN BỔ SUNG MINH CHỨNG');
    expect(overdue.text).toContain('tiêu chí liên quan');
  });

  it('does not render undefined, null, NaN, or raw enum values in all templates', () => {
    const service = new MailTemplateService();
    const templateKeys: MailTemplateKey[] = [
      'application_submitted',
      'application_resubmitted',
      'supplement_requested',
      'supplement_deadline_reminder',
      'application_status_updated',
      'application_rejected',
      'application_result_announced',
    ];

    for (const templateKey of templateKeys) {
      const rendered = service.render({
        templateKey,
        payload: {
          studentName: undefined,
          applicationCode: null,
          deadline: undefined,
          reason: Number.NaN,
          status: 'under_review',
          targetLevel: 'central',
        },
      });

      expect(rendered.text).toContain('Thân chào bạn bạn,');
      expect(rendered.text).not.toMatch(/\b(undefined|null|NaN|under_review|central)\b/);
      expect(rendered.html).not.toMatch(/\b(undefined|null|NaN|under_review|central)\b/);
    }
  });
});

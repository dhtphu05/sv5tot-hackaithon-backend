import {
  Criterion,
  EvidenceSourceType,
  EvidenceStatus,
  IndexingStatus,
  Role,
} from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { scoreEvidenceConfidence } from '../../src/modules/evidences/evidence-confidence.scorer';
import {
  extractEvidenceFields,
  normalizeExtractedFields,
} from '../../src/modules/evidences/evidence-field-extractor';
import { detectEvidenceMissingFields } from '../../src/modules/evidences/evidence-missing-fields.detector';
import { normalizeEvidenceOcr } from '../../src/modules/evidences/evidence-ocr-normalizer';
import { EvidencesService } from '../../src/modules/evidences/evidences.service';
import { AppError } from '../../src/shared/errors/app-error';

describe('evidence OCR normalizer', () => {
  it('uses lines as OCR text first', () => {
    const normalized = normalizeEvidenceOcr(
      {
        text: '',
        lines: [{ text: 'Line one' }, { text: 'Line two' }],
        paragraphs: [{ text: 'Paragraph fallback' }],
        tables: [],
        warnings: [],
        warningMessages: [],
        raw: {},
      },
      'ocrAdvanced:scan-table',
    );

    expect(normalized.ocrText).toBe('Line one\nLine two');
  });

  it('falls back to paragraphs, tables, then ocr_empty_text warning', () => {
    expect(
      normalizeEvidenceOcr(
        {
          text: '',
          lines: [],
          paragraphs: [],
          tables: [{ rows: [['Cell A', 'Cell B']] }],
          warnings: [],
          warningMessages: [],
          raw: {},
        },
        'ocrAdvanced:scan-table',
      ).ocrText,
    ).toContain('Cell A');

    expect(
      normalizeEvidenceOcr(
        {
          text: '',
          lines: [],
          paragraphs: [],
          tables: [],
          warnings: [],
          warningMessages: [],
          raw: {},
        },
        'ocrAdvanced:scan-table',
      ).warnings,
    ).toContain('ocr_empty_text');
  });

  it('supports VNPT raw shape variants', () => {
    const normalized = normalizeEvidenceOcr(
      {
        text: '',
        lines: [],
        paragraphs: [],
        tables: [],
        warnings: [],
        warningMessages: [],
        raw: {
          object: {
            Line: [{ text: 'Raw line' }],
            warning_messages: ['ảnh đầu vào nghiêng'],
          },
        },
      },
      'ocrAdvanced:scan-table',
    );

    expect(normalized.ocrText).toBe('Raw line');
    expect(normalized.warningMessages).toContain('ảnh đầu vào nghiêng');
  });
});

describe('evidence OCR field extractor', () => {
  it('parses Vietnamese certificate text deterministically', () => {
    const fields = normalizeExtractedFields(
      extractEvidenceFields({
        evidenceName: 'Giấy chứng nhận Mùa hè xanh',
        ocr: {
          text: [
            'Hội Sinh viên Trường Đại học Bách khoa',
            'GIẤY CHỨNG NHẬN',
            'Cấp cho: Nguyễn Văn Sinh',
            'MSSV: 102220001 Lớp: 22TCLC',
            'tham gia chiến dịch Mùa hè xanh năm 2026',
            'Đà Nẵng, ngày 20 tháng 4 năm 2026',
            'IELTS 6.5 GPA 3.45/4',
          ].join('\n'),
          lines: [],
          paragraphs: [],
          tables: [],
        },
      }),
    );

    expect(fields).toMatchObject({
      student_name: 'Nguyễn Văn Sinh',
      student_code: '102220001',
      class_name: '22TCLC',
      document_type: 'certificate',
      organizer_level: 'school',
      issue_date: '2026-04-20',
      language_score: 'IELTS 6.5',
      gpa: 3.45,
    });
    expect(fields.organizer).toContain('Hội Sinh viên');
    expect(fields.event_name).toContain('chiến dịch Mùa hè xanh');
  });

  it('does not confuse official document number with studentCode', () => {
    const fields = normalizeExtractedFields(
      extractEvidenceFields({
        evidenceName: 'Giấy chứng nhận Mùa hè xanh',
        ocr: {
          text: [
            'Số: 102220001/QĐ-HSV',
            'GIẤY CHỨNG NHẬN',
            'Cấp cho: Nguyễn Văn Sinh',
            'tham gia chiến dịch Mùa hè xanh 03 ngày tình nguyện',
          ].join('\n'),
          lines: [],
          paragraphs: [],
          tables: [],
        },
      }),
    );

    expect(fields.student_code).toBeUndefined();
    expect(fields.event_name).toContain('chiến dịch Mùa hè xanh');
    expect(fields.volunteer_days).toBe(3);
  });

  it('treats academic transcripts as transcript data, not event evidence', () => {
    const fields = normalizeExtractedFields(
      extractEvidenceFields({
        evidenceName: 'Bảng điểm học tập',
        ocr: {
          text: [
            'ĐẠI HỌC ĐÀ NẴNG',
            'TRƯỜNG ĐẠI HỌC BÁCH KHOA',
            'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM',
            'BẢNG ĐIỂM NĂM HỌC 2024 - 2025',
            'Họ và tên: BÙI QUỐC ANH',
            'Ngày sinh: 20/10/2005',
            'Số thẻ sinh viên: 123230139',
            'Lớp: 23PFIEV2',
            'Ngành: Công nghệ thông tin',
            'Chương trình đào tạo: Công nghệ phần mềm PFIEV K2023',
            'Kết quả: Điểm TBCTL: 3.12; điểm rèn luyện: 87',
            'Đà Nẵng, ngày 03 tháng 09 năm 2025',
          ].join('\n'),
          lines: [],
          paragraphs: [],
          tables: [],
        },
      }),
    );

    expect(fields).toMatchObject({
      student_name: 'BÙI QUỐC ANH',
      student_code: '123230139',
      class_name: '23PFIEV2',
      faculty: 'Công nghệ thông tin',
      document_type: 'transcript',
      issue_date: '2025-09-03',
      gpa: 3.12,
      conduct_score: 87,
    });
    expect(fields.event_name).toBeUndefined();
    expect(fields.organizer).toBeUndefined();
    expect(fields.organizer_level).toBeUndefined();
  });
});

describe('evidence missing fields detector', () => {
  it('detects missing volunteer days', () => {
    expect(
      detectEvidenceMissingFields({
        criterion: Criterion.volunteer,
        fields: { event_name: 'Mùa hè xanh', organizer: 'Hội Sinh viên', issue_date: '2026-06-01' },
      }),
    ).toContainEqual(expect.objectContaining({ field: 'volunteerDays' }));
  });

  it('detects missing integration issue date', () => {
    expect(
      detectEvidenceMissingFields({
        criterion: Criterion.integration,
        fields: { certificate_type: 'language_certificate', organizer: 'IELTS Test Center' },
      }),
    ).toContainEqual(expect.objectContaining({ field: 'issueDate' }));
  });
});

describe('evidence OCR confidence scorer', () => {
  it('marks low-information OCR as needing manual review', () => {
    const scored = scoreEvidenceConfidence({
      ocrSucceeded: true,
      evidenceName: 'Ảnh minh chứng mờ',
      fields: {},
      warnings: ['ảnh mờ'],
    });

    expect(scored.confidence).toBeLessThan(0.6);
    expect(scored.needsManualReview).toBe(true);
    expect(scored.warningCodes).toContain('LOW_CONFIDENCE');
  });
});

describe('evidence card privacy', () => {
  const evidence = {
    id: 'evidence-1',
    applicationId: 'application-1',
    evidenceName: 'Minh chứng',
    criterion: Criterion.volunteer,
    sourceType: EvidenceSourceType.manual_upload,
    status: EvidenceStatus.indexed,
    indexingStatus: IndexingStatus.indexed,
    confidence: 0.8,
    eventId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    application: { studentId: 'student-owner' },
    collectiveProfile: null,
    evidenceFiles: [],
    evidenceCard: {
      id: 'card-1',
      evidenceId: 'evidence-1',
      ocrText: 'short OCR text',
      ocrLinesJson: [],
      ocrParagraphsJson: [],
      ocrTablesJson: [],
      extractedFieldsJson: {},
      normalizedFieldsJson: {},
      warningsJson: [],
      matchedEventId: null,
      matchedParticipantId: null,
      matchedKnowledgeItemIds: [],
      confidence: 0.8,
      sourceEndpoint: 'ocrAdvanced:scan-table',
      smartreaderJobId: 'job-1',
      aiSummary: 'summary',
      rawAiResponse: { hidden: true },
      rawResponseJson: { provider: 'vnpt' },
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  };

  it('does not return raw OCR response to students', async () => {
    const service = new EvidencesService({ findEvidence: async () => evidence } as never);
    const result = await service.getCard(
      {
        id: 'student-owner',
        email: 'student@example.com',
        role: Role.student,
        fullName: 'Student Owner',
        studentCode: null,
        className: null,
        faculty: null,
        avatarUrl: null,
      },
      'evidence-1',
    );

    expect('rawResponseJson' in result.card!).toBe(false);
    expect('rawAiResponse' in result.card!).toBe(false);
    expect(result.card).not.toHaveProperty('confidence');
    expect(result.evidence).not.toHaveProperty('confidence');
    expect(result.evidence.studentStatus).toMatchObject({ code: 'needs_more_info' });
  });

  it('blocks students from reading another student evidence card', async () => {
    const service = new EvidencesService({ findEvidence: async () => evidence } as never);

    await expect(
      service.getCard(
        {
          id: 'student-other',
          email: 'other@example.com',
          role: Role.student,
          fullName: 'Student Other',
          studentCode: null,
          className: null,
          faculty: null,
          avatarUrl: null,
        },
        'evidence-1',
      ),
    ).rejects.toBeInstanceOf(AppError);
  });
});

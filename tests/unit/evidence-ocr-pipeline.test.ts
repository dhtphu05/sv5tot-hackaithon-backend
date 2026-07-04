import { Criterion, EvidenceSourceType, EvidenceStatus, IndexingStatus, Role } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { scoreEvidenceConfidence } from '../../src/modules/evidences/evidence-confidence.scorer';
import { extractEvidenceFields, normalizeExtractedFields } from '../../src/modules/evidences/evidence-field-extractor';
import { EvidencesService } from '../../src/modules/evidences/evidences.service';
import { AppError } from '../../src/shared/errors/app-error';

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

    expect(result.card?.rawResponseJson).toBeUndefined();
    expect(result.card?.rawAiResponse).toBeUndefined();
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

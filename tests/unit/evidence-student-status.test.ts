import { Criterion, EvidenceSourceType, EvidenceStatus, IndexingStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  buildMissingFields,
  buildReadableSummary,
  mapWarnings,
  resolveStudentStatusForCard,
} from '../../src/shared/dto/evidence-student-status';

describe('evidence student status DTO', () => {
  it('maps enough OCR fields to evidence_read without confidence wording', () => {
    const fields = {
      student_name: 'Nguyen Van Sinh',
      student_code: '102220001',
      event_name: 'Mua he xanh',
      organizer: 'Hoi Sinh vien Truong',
      activity_date: '2026-06-01',
      volunteer_days: 3,
    };

    const status = resolveStudentStatusForCard({
      sourceType: EvidenceSourceType.manual_upload,
      status: EvidenceStatus.indexed,
      indexingStatus: IndexingStatus.indexed,
      criterion: Criterion.volunteer,
      ocrText: 'readable text',
      fields,
      warnings: [],
    });

    expect(status.code).toBe('evidence_read');
    expect(status.message.toLowerCase()).not.toContain('confidence');
  });

  it('maps missing volunteer days to needs_more_info', () => {
    const fields = {
      event_name: 'Mua he xanh',
      organizer: 'Hoi Sinh vien Truong',
      activity_date: '2026-06-01',
    };

    const status = resolveStudentStatusForCard({
      sourceType: EvidenceSourceType.manual_upload,
      status: EvidenceStatus.needs_supplement,
      indexingStatus: IndexingStatus.indexed,
      criterion: Criterion.volunteer,
      ocrText: 'readable text',
      fields,
      warnings: [{ code: 'EVENT_MISSING_CONVERTED_VALUE' }],
    });

    expect(status.code).toBe('needs_more_info');
    expect(buildMissingFields(Criterion.volunteer, fields, [{ code: 'EVENT_MISSING_CONVERTED_VALUE' }])).toContainEqual(
      expect.objectContaining({ field: 'volunteerDays' }),
    );
  });

  it('maps empty OCR text to unreadable_file', () => {
    const status = resolveStudentStatusForCard({
      sourceType: EvidenceSourceType.manual_upload,
      status: EvidenceStatus.needs_supplement,
      indexingStatus: IndexingStatus.failed,
      criterion: Criterion.volunteer,
      ocrText: '',
      fields: {},
      warnings: [{ code: 'OCR_EMPTY_TEXT' }],
    });

    expect(status.code).toBe('unreadable_file');
  });

  it('normalizes warning labels and readable summary keys', () => {
    expect(mapWarnings([{ code: 'not_matched_registry' }])[0]).toMatchObject({
      code: 'official_match_not_found',
      label: 'Minh chứng tự tải lên',
    });
    expect(buildReadableSummary({ student_name: 'Nguyen Van Sinh', event_name: 'Mua he xanh' })).toMatchObject({
      studentName: 'Nguyen Van Sinh',
      eventName: 'Mua he xanh',
    });
  });
});

import { Criterion, RosterPreviewValidationStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { normalizeRosterRow } from '../../src/modules/decision-imports/roster-row.normalizer';

describe('decision import roster row normalizer', () => {
  it('removes a trailing class suffix from OCR student names', () => {
    const row = normalizeRosterRow({
      row: {
        MSSV: '104240020',
        'Họ và tên': 'Mai Quang Hưng 24N1',
        Lớp: 'XNDS',
      },
      mapping: {
        studentCode: 'MSSV',
        studentName: 'Họ và tên',
        className: 'Lớp',
      },
      fallbackCriterion: Criterion.volunteer,
    });

    expect(row).toMatchObject({
      studentCode: '104240020',
      studentName: 'Mai Quang Hưng',
      className: 'XNDS',
      validationStatus: RosterPreviewValidationStatus.valid,
    });
  });
});

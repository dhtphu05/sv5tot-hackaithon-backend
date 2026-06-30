import { describe, expect, it } from 'vitest';
import {
  applyColumnMapping,
  normalizeParticipationStatus,
  normalizeStudentCode,
  parseConvertedValue,
} from '../../src/modules/event-registry/event-participant.normalizer';

describe('event participant normalizer', () => {
  it('keeps student code as a trimmed string', () => {
    expect(normalizeStudentCode(' 00102220001 ')).toBe('00102220001');
  });

  it('defaults empty participation status to confirmed', () => {
    expect(normalizeParticipationStatus('')).toBe('confirmed');
  });

  it('parses converted value without losing decimal commas', () => {
    expect(parseConvertedValue('3,5')).toBe(3.5);
  });

  it('applies column mapping and fallback converted value', () => {
    const participant = applyColumnMapping(
      {
        MSSV: '102220001',
        'Họ và tên': ' Nguyễn   Văn Sinh ',
        Lớp: '22T_DT1',
        Khoa: 'Khoa Công nghệ Thông tin',
      },
      {
        studentCode: 'MSSV',
        studentName: 'Họ và tên',
        className: 'Lớp',
        faculty: 'Khoa',
        convertedValue: 'Số ngày',
      },
      { convertedValue: 3 },
    );

    expect(participant).toMatchObject({
      studentCode: '102220001',
      studentName: 'Nguyễn Văn Sinh',
      className: '22T_DT1',
      convertedValue: 3,
    });
  });
});

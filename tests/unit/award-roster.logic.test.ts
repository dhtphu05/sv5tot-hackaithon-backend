import { AwardLevel, AwardRecipientMatchStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  buildAwardRosterPreview,
  getAwardRosterFormat,
  suggestAwardRosterMapping,
  validateAwardRosterMapping,
  type AwardRosterMapping,
} from '../../src/modules/award-decisions/award-roster.logic';

const schoolA = {
  id: 'school-a',
  code: 'DUT',
  name: 'Đại học Bách khoa - Đại học Đà Nẵng',
  shortName: 'DUT',
  aliases: ['ĐH Bách khoa Đà Nẵng'],
};
const schoolB = {
  id: 'school-b',
  code: 'DUE',
  name: 'Đại học Kinh tế - Đại học Đà Nẵng',
  shortName: 'DUE',
  aliases: ['ĐH Kinh tế Đà Nẵng'],
};
const defaultMapping: AwardRosterMapping = {
  studentCode: 'MSSV',
  fullName: 'Họ và tên',
  className: 'Lớp',
};

function preview(input: {
  columns: string[];
  sourceRows: Array<Array<string | number | boolean | null>>;
  mapping: AwardRosterMapping;
  awardLevel: AwardLevel;
  issuer: typeof schoolA | { id: string; code: string; name: string; shortName: string; aliases: string[] };
  institutions: Array<typeof schoolA>;
  users: Array<{ id: string; studentCode: string; workspaceId: string }>;
}) {
  const { awardLevel, issuer, institutions, users, ...data } = input;
  return buildAwardRosterPreview({
    ...data,
    context: { awardLevel, issuer, institutions, users },
  });
}

describe('Award roster mapping and validation', () => {
  it('supports only CSV, XLSX, and PDF formats and rejects legacy XLS', () => {
    expect(getAwardRosterFormat('roster.csv', 'text/csv')).toBe('csv');
    expect(getAwardRosterFormat('roster.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('xlsx');
    expect(getAwardRosterFormat('roster.pdf', 'application/pdf')).toBe('pdf');
    expect(getAwardRosterFormat('roster', 'text/csv')).toBe('csv');
    expect(() => getAwardRosterFormat('roster.xls', 'application/vnd.ms-excel')).toThrow('Legacy XLS');
  });

  it('rejects mappings that select a missing source column or reuse one column for two fields', () => {
    expect(validateAwardRosterMapping(['MSSV', 'Họ và tên'], { studentCode: 'MSSV', fullName: 'missing' })).toBe(false);
    expect(validateAwardRosterMapping(['MSSV'], { studentCode: 'MSSV', fullName: 'MSSV' })).toBe(false);
  });

  it('suggests code, name, class, and institution columns from Vietnamese or English headers', () => {
    expect(suggestAwardRosterMapping(['Mã sinh viên', 'Full name', 'Class', 'Tên trường'])).toEqual({
      studentCode: 'Mã sinh viên',
      fullName: 'Full name',
      className: 'Class',
      institution: 'Tên trường',
    });
  });

  it('uses the SCHOOL issuer by default and matches a text student code within that workspace', () => {
    const rows = preview({
      columns: ['MSSV', 'Họ và tên', 'Lớp'],
      sourceRows: [['00123456', 'Nguyễn An', '22CTT1']],
      mapping: defaultMapping,
      awardLevel: AwardLevel.SCHOOL,
      issuer: schoolA,
      institutions: [schoolA],
      users: [{ id: 'student-1', studentCode: '00123456', workspaceId: schoolA.id }],
    });

    expect(rows.rows[0]).toMatchObject({
      studentCode: '00123456',
      institutionWorkspaceId: schoolA.id,
      status: 'VALID',
      matchStatus: AwardRecipientMatchStatus.MATCHED,
      matchedUserId: 'student-1',
    });
  });

  it('marks numeric Excel MSSV invalid and does not restore leading zeroes', () => {
    const rows = preview({
      columns: ['MSSV', 'Họ và tên'],
      sourceRows: [[123456, 'Trần Bình']],
      mapping: { studentCode: 'MSSV', fullName: 'Họ và tên' },
      awardLevel: AwardLevel.SCHOOL,
      issuer: schoolA,
      institutions: [schoolA],
      users: [],
    });

    expect(rows.rows[0]).toMatchObject({ status: 'INVALID', studentCode: null });
    expect(rows.rows[0].errors).toContain('STUDENT_CODE_MUST_BE_TEXT');
  });

  it('blocks missing required fields and leaves an unregistered student unmatched but valid', () => {
    const rows = preview({
      columns: ['MSSV', 'Họ và tên'],
      sourceRows: [['00001234', ''], ['00005678', 'Sinh viên mới']],
      mapping: { studentCode: 'MSSV', fullName: 'Họ và tên' },
      awardLevel: AwardLevel.SCHOOL,
      issuer: schoolA,
      institutions: [schoolA],
      users: [],
    });

    expect(rows.rows[0]).toMatchObject({ status: 'INVALID' });
    expect(rows.rows[0].errors).toContain('FULL_NAME_REQUIRED');
    expect(rows.rows[1]).toMatchObject({
      status: 'VALID',
      matchStatus: AwardRecipientMatchStatus.UNMATCHED,
      matchedUserId: null,
    });
    expect(rows.summary.invalid).toBe(1);
  });

  it('flags all repeated SCHOOL student codes as duplicates', () => {
    const rows = preview({
      columns: ['MSSV', 'Họ và tên'],
      sourceRows: [['00123456', 'Nguyễn An'], ['00123456', 'Nguyễn An']],
      mapping: { studentCode: 'MSSV', fullName: 'Họ và tên' },
      awardLevel: AwardLevel.SCHOOL,
      issuer: schoolA,
      institutions: [schoolA],
      users: [],
    });

    expect(rows.rows.map((row) => row.status)).toEqual(['DUPLICATE', 'DUPLICATE']);
    expect(rows.summary.duplicate).toBe(2);
  });

  it('resolves UDN schools by exact normalized known names and matches accounts in that school only', () => {
    const rows = preview({
      columns: ['MSSV', 'Họ và tên', 'Trường'],
      sourceRows: [
        ['00123456', 'Nguyễn An', 'DUT'],
        ['00123456', 'Trần Bình', 'DUE'],
      ],
      mapping: { ...defaultMapping, institution: 'Trường' },
      awardLevel: AwardLevel.UNIVERSITY_SYSTEM,
      issuer: { id: 'udn', code: 'UDN', name: 'Đại học Đà Nẵng', shortName: 'UDN', aliases: [] },
      institutions: [schoolA, schoolB],
      users: [
        { id: 'student-a', studentCode: '00123456', workspaceId: schoolA.id },
        { id: 'student-b', studentCode: '00123456', workspaceId: schoolB.id },
      ],
    });

    expect(rows.rows.map((row) => row.status)).toEqual(['VALID', 'VALID']);
    expect(rows.rows.map((row) => row.institutionWorkspaceId)).toEqual([schoolA.id, schoolB.id]);
    expect(rows.rows.map((row) => row.matchedUserId)).toEqual(['student-a', 'student-b']);
  });

  it('marks missing, unknown, and ambiguous UDN school context as conflicts', () => {
    const duplicateAlias = { ...schoolB, aliases: ['DUT'] };
    const rows = preview({
      columns: ['MSSV', 'Họ và tên', 'Trường'],
      sourceRows: [['00000001', 'A', 'DUT'], ['00000002', 'B', 'Unknown University']],
      mapping: { studentCode: 'MSSV', fullName: 'Họ và tên', institution: 'Trường' },
      awardLevel: AwardLevel.UNIVERSITY_SYSTEM,
      issuer: { id: 'udn', code: 'UDN', name: 'Đại học Đà Nẵng', shortName: 'UDN', aliases: [] },
      institutions: [schoolA, duplicateAlias],
      users: [],
    });
    const missingContext = preview({
      columns: ['MSSV', 'Họ và tên'],
      sourceRows: [['00000003', 'C']],
      mapping: { studentCode: 'MSSV', fullName: 'Họ và tên' },
      awardLevel: AwardLevel.UNIVERSITY_SYSTEM,
      issuer: { id: 'udn', code: 'UDN', name: 'Đại học Đà Nẵng', shortName: 'UDN', aliases: [] },
      institutions: [schoolA, schoolB],
      users: [],
    });

    expect(rows.rows.map((row) => row.status)).toEqual(['CONFLICT', 'CONFLICT']);
    expect(missingContext.rows[0]).toMatchObject({ status: 'CONFLICT', institutionWorkspaceId: null });
  });

  it('marks a SCHOOL roster institution that does not resolve to its issuer as a conflict', () => {
    const rows = preview({
      columns: ['MSSV', 'Họ và tên', 'Trường'],
      sourceRows: [['00123456', 'Nguyễn An', 'DUE']],
      mapping: { studentCode: 'MSSV', fullName: 'Họ và tên', institution: 'Trường' },
      awardLevel: AwardLevel.SCHOOL,
      issuer: schoolA,
      institutions: [schoolA, schoolB],
      users: [],
    });

    expect(rows.rows[0]).toMatchObject({ status: 'CONFLICT', institutionWorkspaceId: null });
  });
});

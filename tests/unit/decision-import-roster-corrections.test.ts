import { Criterion, RosterPreviewValidationStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  applyDecisionRosterCorrections,
  decisionRosterCorrectionKey,
} from '../../src/modules/decision-imports/decision-roster-corrections';
import {
  revertDecisionRosterCorrectionSchema,
  updateDecisionRosterCorrectionSchema,
} from '../../src/modules/decision-imports/decision-imports.validation';
import { buildPreviewRowsFromTables } from '../../src/modules/decision-imports/decision-roster-parser.service';

const mapping = { studentCode: 'MSSV', studentName: 'Họ tên', className: 'Lớp' };
const tables = [{
  tableIndex: 0,
  header: ['MSSV', 'Họ tên', 'Lớp'],
  rows: [
    { __sourceRowIndex: 1, MSSV: '00123', 'Họ tên': '', Lớp: '23CT1' },
    { __sourceRowIndex: 2, MSSV: '00123', 'Họ tên': 'Trần An', Lớp: '23CT2' },
  ],
  rawRows: [],
}];

describe('DecisionImport roster corrections', () => {
  it('overlays canonical fields without changing OCR raw rows and revalidates duplicates', () => {
    const base = buildPreviewRowsFromTables({ tables, mapping, fallbackCriterion: Criterion.volunteer });
    const key = decisionRosterCorrectionKey(base[0]!);
    const corrected = applyDecisionRosterCorrections(base, {
      [key]: { studentCode: '00999', studentName: 'Nguyễn An' },
    });

    expect(corrected[0]).toMatchObject({
      studentCode: '00999',
      studentName: 'Nguyễn An',
      className: '23CT1',
      validationStatus: RosterPreviewValidationStatus.valid,
      rawRow: { MSSV: '00123', 'Họ tên': '', Lớp: '23CT1' },
    });
    expect(corrected[1]?.validationStatus).toBe(RosterPreviewValidationStatus.valid);
    expect(corrected[0]?.rawRow).toEqual(base[0]?.rawRow);
  });

  it('recomputes duplicate status after a correction and revert removes only that overlay', () => {
    const base = buildPreviewRowsFromTables({ tables, mapping, fallbackCriterion: Criterion.volunteer });
    const key = decisionRosterCorrectionKey(base[0]!);
    const corrected = applyDecisionRosterCorrections(base, {
      [key]: { studentCode: '00999', studentName: 'Nguyễn An' },
    });
    const reverted = applyDecisionRosterCorrections(base, {});

    expect(corrected.map((row) => row.validationStatus)).toEqual([
      RosterPreviewValidationStatus.valid,
      RosterPreviewValidationStatus.valid,
    ]);
    expect(reverted.map((row) => row.validationStatus)).toEqual([
      RosterPreviewValidationStatus.duplicate,
      RosterPreviewValidationStatus.duplicate,
    ]);
    expect(reverted[0]?.studentCode).toBe('00123');
  });

  it('accepts only canonical fields and rejects empty or unknown corrections', () => {
    expect(updateDecisionRosterCorrectionSchema.safeParse({ studentCode: '00999', className: null }).success).toBe(true);
    expect(updateDecisionRosterCorrectionSchema.safeParse({ studentCode: '' }).success).toBe(false);
    expect(updateDecisionRosterCorrectionSchema.safeParse({ sourceRowIndex: 8 }).success).toBe(false);
    expect(updateDecisionRosterCorrectionSchema.safeParse({}).success).toBe(false);
    expect(revertDecisionRosterCorrectionSchema.safeParse({}).success).toBe(true);
  });
});

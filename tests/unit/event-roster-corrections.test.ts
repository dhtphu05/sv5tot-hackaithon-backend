import { describe, expect, it } from 'vitest';
import {
  addEventRosterCorrection,
  applyEventRosterCorrections,
  findDuplicateEventStudentCodes,
  readEventRosterCorrections,
  removeEventRosterCorrection,
} from '../../src/modules/event-registry/event-roster-corrections';

const participants = [
  { studentCode: '001', studentName: 'An', className: null, faculty: null, participationStatus: 'confirmed', convertedValue: null },
  { studentCode: '002', studentName: 'Bình', className: null, faculty: null, participationStatus: 'confirmed', convertedValue: null },
];

describe('Event Registry roster corrections', () => {
  it('keeps extracted rows immutable and applies canonical edits only to effective participants', () => {
    const sourceRows = [{ MSSV: '001', 'Họ tên': 'A' }];
    const correction = addEventRosterCorrection({}, 2, { studentName: 'Nguyễn An', className: '24CT1' });
    const effective = applyEventRosterCorrections(participants.slice(0, 1), correction);

    expect(sourceRows).toEqual([{ MSSV: '001', 'Họ tên': 'A' }]);
    expect(effective[0]).toMatchObject({ studentCode: '001', studentName: 'Nguyễn An', className: '24CT1' });
    expect(readEventRosterCorrections({ sourceRows, rowCorrections: correction })).toEqual(correction);
  });

  it('recomputes duplicates after a corrected student code and reverts only that correction', () => {
    const correction = addEventRosterCorrection({}, 3, { studentCode: '001' });
    const effective = applyEventRosterCorrections(participants, correction);
    expect(findDuplicateEventStudentCodes(effective)).toEqual(['001']);

    const reverted = removeEventRosterCorrection(correction, 3);
    expect(reverted).toEqual({});
    expect(findDuplicateEventStudentCodes(applyEventRosterCorrections(participants, reverted))).toEqual([]);
  });

  it('does not apply corrections for another source row or malformed stored values', () => {
    const stored = readEventRosterCorrections({ rowCorrections: { '3': { studentName: 'Changed' }, bad: { studentCode: '9' } } });
    expect(applyEventRosterCorrections(participants, stored)[0]).toEqual(participants[0]);
    expect(applyEventRosterCorrections(participants, stored)[1].studentName).toBe('Changed');
  });
});

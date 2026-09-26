import { describe, expect, it } from 'vitest';
import { isEvidenceDateOutsideSchoolYear } from '../../src/modules/rules/school-year-evidence';

describe('school-year evidence date advice', () => {
  it('accepts dates within the application school-year bounds', () => {
    expect(outside({ activity_date: '2025-09-01' })).toBe(false);
    expect(outside({ issue_date: '31/08/2026' })).toBe(false);
  });

  it('flags only valid dates clearly outside the application school year', () => {
    expect(outside({ activity_date: { value: '2024-08-31' } })).toBe(true);
    expect(outside({ issue_date: '01/09/2026' })).toBe(true);
  });

  it('does not infer an out-of-year finding from missing or invalid dates', () => {
    expect(outside({})).toBe(false);
    expect(outside({ activity_date: '2025-02-30' })).toBe(false);
    expect(outside({ activity_date: 'fall semester' })).toBe(false);
  });

  it('does not apply a school-year comparison to an invalid year label', () => {
    expect(
      isEvidenceDateOutsideSchoolYear(
        { evidenceCard: { extractedFieldsJson: { activity_date: '2024-03-10' } } },
        '2025',
      ),
    ).toBe(false);
  });
});

function outside(fields: Record<string, unknown>) {
  return isEvidenceDateOutsideSchoolYear(
    { evidenceCard: { extractedFieldsJson: fields } },
    '2025-2026',
  );
}

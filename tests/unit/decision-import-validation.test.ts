import { Criterion } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  confirmDecisionImportSchema,
  createDecisionImportSchema,
} from '../../src/modules/decision-imports/decision-imports.validation';

describe('decision import validation', () => {
  it('accepts date-only values from friendly forms', () => {
    const parsed = createDecisionImportSchema.parse({
      title: 'Quyết định công nhận sinh viên 5 tốt',
      startDate: '2026-07-01',
      endDate: '2026-07-05',
      convertedValue: '3',
    });

    expect(parsed.startDate).toBe('2026-07-01T00:00:00.000Z');
    expect(parsed.endDate).toBe('2026-07-05T00:00:00.000Z');
    expect(parsed.convertedValue).toBe(3);
  });

  it('treats blank optional fields as omitted', () => {
    const parsed = confirmDecisionImportSchema.parse({
      criterion: Criterion.volunteer,
      eventName: '',
      organizer: '   ',
      convertedUnit: '',
      startDate: '',
      endDate: '',
    });

    expect(parsed.eventName).toBeUndefined();
    expect(parsed.organizer).toBeUndefined();
    expect(parsed.convertedUnit).toBeUndefined();
    expect(parsed.startDate).toBeUndefined();
    expect(parsed.endDate).toBeUndefined();
  });
});

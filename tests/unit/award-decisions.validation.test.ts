import { describe, expect, it } from 'vitest';
import {
  createAwardDecisionSchema,
  listAwardDecisionsQuerySchema,
  updateAwardDecisionSchema,
} from '../../src/modules/award-decisions/award-decisions.validation';

describe('Award Decision validation', () => {
  it('requires a school year and normalizes date-only values', () => {
    expect(
      createAwardDecisionSchema.parse({
        schoolYear: '2025-2026',
        decisionNumber: ' 45-QĐ/HSV ',
        decisionDate: '2026-06-15',
      }),
    ).toMatchObject({
      schoolYear: '2025-2026',
      decisionNumber: '45-QĐ/HSV',
      decisionDate: '2026-06-15T00:00:00.000Z',
    });
    expect(createAwardDecisionSchema.safeParse({}).success).toBe(false);
  });

  it('rejects client-controlled level, status, and empty patches', () => {
    expect(
      createAwardDecisionSchema.safeParse({
        schoolYear: '2025-2026',
        awardLevel: 'UNIVERSITY_SYSTEM',
        status: 'CONFIRMED',
      }).success,
    ).toBe(false);
    expect(updateAwardDecisionSchema.safeParse({}).success).toBe(false);
  });

  it('accepts archive visibility filters and rejects contradictory explicit status filters', () => {
    expect(listAwardDecisionsQuerySchema.parse({ archive: 'exclude' })).toMatchObject({
      archive: 'exclude',
      page: 1,
      limit: 20,
    });
    expect(listAwardDecisionsQuerySchema.parse({ status: 'ARCHIVED' }).status).toBe('ARCHIVED');
    expect(
      listAwardDecisionsQuerySchema.safeParse({ status: 'ARCHIVED', archive: 'exclude' }).success,
    ).toBe(false);
    expect(
      listAwardDecisionsQuerySchema.safeParse({ status: 'DRAFT', archive: 'only' }).success,
    ).toBe(false);
    expect(listAwardDecisionsQuerySchema.safeParse({ archive: 'hidden' }).success).toBe(false);
  });
});

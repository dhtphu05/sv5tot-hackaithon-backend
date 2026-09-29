import { describe, expect, it } from 'vitest';
import {
  eventRosterCorrectionSchema,
  eventRosterRowParamsSchema,
} from '../../src/modules/event-registry/event-registry.validation';

describe('Event Registry roster correction contract', () => {
  it('accepts only canonical roster fields and requires at least one edit', () => {
    expect(eventRosterCorrectionSchema.parse({ studentCode: '001234' })).toEqual({ studentCode: '001234' });
    expect(eventRosterCorrectionSchema.safeParse({ studentCode: '' }).success).toBe(false);
    expect(eventRosterCorrectionSchema.safeParse({ email: 'student@example.test' }).success).toBe(false);
    expect(eventRosterCorrectionSchema.safeParse({}).success).toBe(false);
  });

  it('requires event, file, and a data-row number scoped to one roster file', () => {
    expect(eventRosterRowParamsSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      eventFileId: '22222222-2222-4222-8222-222222222222',
      rowNumber: '2',
    }).success).toBe(true);
    expect(eventRosterRowParamsSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      eventFileId: '22222222-2222-4222-8222-222222222222',
      rowNumber: '1',
    }).success).toBe(false);
  });
});

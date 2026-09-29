import { describe, expect, it } from 'vitest';
import { getEventRosterFormat } from '../../src/modules/event-registry/event-roster-format';

describe('Event Registry roster format contract', () => {
  it.each([
    ['roster.csv', 'text/csv', 'csv'],
    ['roster.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
    ['roster.pdf', 'application/pdf', 'pdf'],
  ] as const)('accepts %s as %s', (originalName, mimeType, expected) => {
    expect(getEventRosterFormat(originalName, mimeType)).toBe(expected);
  });

  it.each([
    ['roster.xls', 'application/vnd.ms-excel'],
    ['roster.png', 'image/png'],
    ['roster.pdf', 'text/csv'],
  ])('rejects unsupported or mismatched roster file %s', (originalName, mimeType) => {
    expect(() => getEventRosterFormat(originalName, mimeType)).toThrow();
  });
});

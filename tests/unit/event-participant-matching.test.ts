import { describe, expect, it } from 'vitest';
import {
  normalizeMatchingText,
  stripTrailingClassSuffixFromName,
} from '../../src/modules/event-registry/event-participant-matching';

describe('event participant matching helpers', () => {
  it('ignores a trailing compact class code when matching names', () => {
    expect(normalizeMatchingText('Mai Quang Hưng 24N1')).toBe(normalizeMatchingText('Mai Quang Hưng'));
  });

  it('ignores a trailing split class code when matching names', () => {
    expect(normalizeMatchingText('Nguyễn Văn Trường Sơn 21T DT')).toBe(
      normalizeMatchingText('Nguyễn Văn Trường Sơn'),
    );
  });

  it('strips class suffixes from display names without changing normal names', () => {
    expect(stripTrailingClassSuffixFromName('  Mai   Quang Hưng 24N1 ')).toBe('Mai Quang Hưng');
    expect(stripTrailingClassSuffixFromName('Nguyễn Đức Trung Thành')).toBe('Nguyễn Đức Trung Thành');
  });
});

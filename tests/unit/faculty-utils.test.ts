import { describe, expect, it } from 'vitest';
import { facultyMatches, normalizeFacultyName } from '../../src/shared/utils/faculty';

describe('faculty utils', () => {
  it('normalizes accent/case and optional Khoa prefix', () => {
    expect(normalizeFacultyName('Khoa Công nghệ Thông tin')).toBe('cong nghe thong tin');
    expect(normalizeFacultyName('Công nghệ thông tin')).toBe('cong nghe thong tin');
  });

  it('matches common signup faculty text with seeded officer faculty', () => {
    expect(facultyMatches('Khoa Công nghệ Thông tin', 'Công nghệ thông tin')).toBe(true);
    expect(facultyMatches('Khoa Kinh tế', 'Công nghệ thông tin')).toBe(false);
  });
});

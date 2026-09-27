import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ readSheet: vi.fn() }));

vi.mock('read-excel-file/node', () => ({ readSheet: mocks.readSheet }));

import { readRosterTable } from '../../src/shared/utils/roster-table-reader';

describe('readRosterTable', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads CSV BOM, quoted commas, and escaped quotes without changing text values', async () => {
    const result = await readRosterTable({
      buffer: Buffer.from('\uFEFFMSSV,Họ và tên,Ghi chú\r\n00123456,"Nguyễn, An","nói ""xin chào"""\r\n'),
      format: 'csv',
    });

    expect(result).toEqual({
      columns: ['MSSV', 'Họ và tên', 'Ghi chú'],
      rows: [['00123456', 'Nguyễn, An', 'nói "xin chào"']],
    });
  });

  it('preserves XLSX cell value types so numeric student codes stay numeric', async () => {
    mocks.readSheet.mockResolvedValueOnce([
      ['MSSV', 'Họ và tên'],
      ['00123456', 'Nguyễn An'],
      [123456, 'Trần Bình'],
      [null, null],
    ]);

    const result = await readRosterTable({ buffer: Buffer.from('xlsx'), format: 'xlsx' });

    expect(result).toEqual({
      columns: ['MSSV', 'Họ và tên'],
      rows: [['00123456', 'Nguyễn An'], [123456, 'Trần Bình']],
    });
  });

  it('can preserve blank XLSX rows for the existing Collective import semantics', async () => {
    mocks.readSheet.mockResolvedValueOnce([
      ['MSSV', 'Họ và tên'],
      ['00123456', 'Nguyễn An'],
      [null, null],
    ]);

    const result = await readRosterTable({
      buffer: Buffer.from('xlsx'),
      format: 'xlsx',
      preserveBlankRows: true,
    });

    expect(result.rows).toEqual([['00123456', 'Nguyễn An'], [null, null]]);
  });
});

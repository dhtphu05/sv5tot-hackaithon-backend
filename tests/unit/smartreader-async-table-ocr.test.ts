import { describe, expect, it, vi } from 'vitest';
import { runSmartReaderAsyncTableOcr } from '../../src/modules/smartreader/smartreader-async-table-ocr';
import type { SmartReaderAdapter, SmartReaderAsyncResult } from '../../src/modules/smartreader/smartreader.types';

const completedResult = {
  text: '',
  lines: [],
  paragraphs: [],
  tables: [{ rows: [['MSSV', 'Họ và tên'], ['00123456', 'Nguyễn An']] }],
  warnings: [],
  warningMessages: [],
  status: 'completed',
  raw: {},
} satisfies SmartReaderAsyncResult;

describe('runSmartReaderAsyncTableOcr', () => {
  it('reuses async SmartReader table extraction and returns its completed table result', async () => {
    const adapter = {
      startAdvancedAsync: vi.fn().mockResolvedValue({ sessionId: 'session-1', warnings: [], warningMessages: [], raw: {} }),
      getAdvancedAsyncResult: vi.fn().mockResolvedValue(completedResult),
    } as unknown as SmartReaderAdapter;

    await expect(runSmartReaderAsyncTableOcr({
      adapter,
      fileHash: 'hash-1',
      fileType: 'pdf',
      maxPolls: 2,
      waitBeforePoll: async () => undefined,
    })).resolves.toMatchObject({ tables: completedResult.tables });

    expect(adapter.startAdvancedAsync).toHaveBeenCalledWith({ fileHash: 'hash-1', fileType: 'pdf', details: true, exporter: 'json' });
    expect(adapter.getAdvancedAsyncResult).toHaveBeenCalledWith('session-1');
  });

  it('surfaces a failed SmartReader result so the Award indexing job can be retried', async () => {
    const adapter = {
      startAdvancedAsync: vi.fn().mockResolvedValue({ sessionId: 'session-1', warnings: [], warningMessages: [], raw: {} }),
      getAdvancedAsyncResult: vi.fn().mockResolvedValue({ ...completedResult, status: 'failed' }),
    } as unknown as SmartReaderAdapter;

    await expect(runSmartReaderAsyncTableOcr({
      adapter,
      fileHash: 'hash-1',
      fileType: 'pdf',
      maxPolls: 1,
      waitBeforePoll: async () => undefined,
    })).rejects.toMatchObject({ statusCode: 502 });
  });
});

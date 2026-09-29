import { FileStorageType, IndexingStatus, JobType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findEventFile: vi.fn(),
  updateEventFile: vi.fn(),
  updateManyEventFile: vi.fn(),
  transaction: vi.fn(),
  createAudit: vi.fn(),
  getSignedReadUrl: vi.fn(),
  readRosterTable: vi.fn(),
  extractStructuredDocument: vi.fn(),
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({
  prisma: {
    eventFile: {
      findUnique: mocks.findEventFile,
      update: mocks.updateEventFile,
      updateMany: mocks.updateManyEventFile,
    },
    $transaction: mocks.transaction,
  },
}));
vi.mock('../../src/modules/applications/application.helpers', () => ({
  createApplicationAudit: mocks.createAudit,
}));
vi.mock('../../src/modules/storage/storage.service', () => ({
  StorageService: class {
    getSignedReadUrl = mocks.getSignedReadUrl;
  },
}));
vi.mock('../../src/shared/utils/roster-table-reader', () => ({ readRosterTable: mocks.readRosterTable }));
vi.mock('../../src/modules/ai/openai-document-extraction', () => ({
  extractStructuredDocument: mocks.extractStructuredDocument,
}));

import { processEventRosterIndexingJob } from '../../src/modules/jobs/processors/event-roster-indexing.processor';

const eventFile = {
  id: 'event-file-1',
  fileId: 'file-1',
  eventId: 'event-1',
  file: {
    id: 'file-1',
    workspaceId: 'workspace-1',
    originalName: 'roster.csv',
    mimeType: 'text/csv',
    storageType: FileStorageType.local,
    filePath: 'missing-test-file.csv',
  },
  event: {
    id: 'event-1',
    workspaceId: 'workspace-1',
    createdBy: 'staff-1',
    convertedValue: 3,
  },
};

function job() {
  return {
    id: 'job-1',
    targetId: eventFile.id,
    workspaceId: 'workspace-1',
    jobType: JobType.event_roster_indexing,
    inputJson: {},
  } as never;
}

describe('event roster indexing processor', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    mocks.findEventFile.mockResolvedValue(eventFile);
    mocks.updateEventFile.mockResolvedValue({ ...eventFile, indexingStatus: IndexingStatus.ocr_processing });
    mocks.updateManyEventFile.mockResolvedValue({ count: 1 });
    mocks.getSignedReadUrl.mockResolvedValue('https://storage.test/roster');
    mocks.readRosterTable.mockResolvedValue({
      columns: ['MSSV', 'Họ và tên', 'Lớp'],
      rows: [['00123456', 'Nguyễn An', '23CT1']],
    });
    mocks.extractStructuredDocument.mockResolvedValue({
      data: { columns: ['MSSV', 'Họ và tên', 'Lớp'], rows: [['00123456', 'Nguyễn An', '23CT1']] },
      telemetry: { provider: 'openai', useCase: 'event_roster', requestId: 'event-req-1' },
    });
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        eventFile: {
          update: mocks.updateEventFile,
          updateMany: mocks.updateManyEventFile,
          findUnique: vi.fn().mockResolvedValue(eventFile),
        },
      }),
    );
  });

  it('fails a CSV read error without inventing roster rows', async () => {
    await expect(processEventRosterIndexingJob(job())).rejects.toMatchObject({
      code: 'ROSTER_PARSE_FAILED',
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.updateManyEventFile).toHaveBeenLastCalledWith({
      where: { id: eventFile.id, eventId: eventFile.eventId, fileId: eventFile.file.id, indexingStatus: IndexingStatus.ocr_processing },
      data: { indexingStatus: IndexingStatus.failed },
    });
    expect(mocks.createAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      afterStateJson: { eventFileId: eventFile.id, code: 'ROSTER_PARSE_FAILED' },
    }));
  });

  it('rejects image files outside the Event Registry roster contract', async () => {
    mocks.findEventFile.mockResolvedValueOnce({
      ...eventFile,
      file: { ...eventFile.file, originalName: 'roster.png', mimeType: 'image/png' },
    });

    await expect(processEventRosterIndexingJob(job())).rejects.toMatchObject({ code: 'FILE_TYPE_NOT_ALLOWED' });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.updateManyEventFile).toHaveBeenLastCalledWith({
      where: { id: eventFile.id, eventId: eventFile.eventId, fileId: eventFile.file.id, indexingStatus: IndexingStatus.ocr_processing },
      data: { indexingStatus: IndexingStatus.failed },
    });
    expect(mocks.createAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      afterStateJson: { eventFileId: eventFile.id, code: 'FILE_TYPE_NOT_ALLOWED' },
    }));
  });

  it('extracts a PDF roster with the Event schema and stores a review preview', async () => {
    const pdf = Buffer.from('synthetic-pdf');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength),
    }));
    mocks.findEventFile.mockResolvedValueOnce({
      ...eventFile,
      file: { ...eventFile.file, storageType: FileStorageType.r2, originalName: 'private-roster.pdf', mimeType: 'application/pdf' },
    });

    const result = await processEventRosterIndexingJob(job());

    expect(mocks.extractStructuredDocument).toHaveBeenCalledWith(expect.objectContaining({
      useCase: 'event_roster',
      model: 'gpt-6-luna',
      schemaName: 'event_roster_table',
      content: [expect.objectContaining({ type: 'input_file', filename: 'event-roster.pdf' })],
    }));
    expect(JSON.stringify(mocks.extractStructuredDocument.mock.calls[0]?.[0])).not.toContain('private-roster.pdf');
    expect(result).toMatchObject({
      sourceRows: [{ MSSV: '00123456', 'Họ và tên': 'Nguyễn An', Lớp: '23CT1' }],
      rows: [{ MSSV: '00123456', 'Họ và tên': 'Nguyễn An', Lớp: '23CT1' }],
      quality: { rowCount: 1, missingStudentCodeRows: 0 },
    });
  });

  it.each([
    ['text/csv', 'roster.csv', 'csv'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'roster.xlsx', 'xlsx'],
  ])('keeps %s on the local parser path', async (mimeType, originalName, format) => {
    mocks.findEventFile.mockResolvedValueOnce({
      ...eventFile,
      file: { ...eventFile.file, storageType: FileStorageType.r2, originalName, mimeType },
    });
    const csv = Buffer.from('synthetic-table');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => csv.buffer.slice(csv.byteOffset, csv.byteOffset + csv.byteLength),
    }));

    await processEventRosterIndexingJob(job());

    expect(mocks.readRosterTable).toHaveBeenCalledWith(expect.objectContaining({ format }));
    expect(mocks.extractStructuredDocument).not.toHaveBeenCalled();
  });

  it('fails provider errors without persisting any preview', async () => {
    const pdf = Buffer.from('synthetic-pdf');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength),
    }));
    mocks.findEventFile.mockResolvedValueOnce({
      ...eventFile,
      file: { ...eventFile.file, storageType: FileStorageType.r2, originalName: 'roster.pdf', mimeType: 'application/pdf' },
    });
    mocks.extractStructuredDocument.mockRejectedValueOnce(new Error('provider failure'));

    await expect(processEventRosterIndexingJob(job())).rejects.toMatchObject({ code: 'ROSTER_PARSE_FAILED' });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.updateManyEventFile).toHaveBeenCalledWith(expect.objectContaining({
      data: { indexingStatus: IndexingStatus.failed },
    }));
  });
});

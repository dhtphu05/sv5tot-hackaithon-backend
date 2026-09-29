import { Criterion, DecisionImportStatus, JobType, Role } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findImport: vi.fn(),
  updateImport: vi.fn(),
  transaction: vi.fn(),
  deleteTables: vi.fn(),
  createTable: vi.fn(),
  deleteRows: vi.fn(),
  createRows: vi.fn(),
  auditLog: vi.fn(),
  getSignedReadUrl: vi.fn(),
  extractStructuredDocument: vi.fn(),
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({
  prisma: {
    decisionImport: { findUnique: mocks.findImport, update: mocks.updateImport },
    $transaction: mocks.transaction,
  },
}));
vi.mock('../../src/modules/audit/audit.service', () => ({
  AuditService: class {
    log = mocks.auditLog;
  },
}));
vi.mock('../../src/modules/storage/storage.service', () => ({
  StorageService: class {
    getSignedReadUrl = mocks.getSignedReadUrl;
  },
}));
vi.mock('../../src/modules/ai/openai-document-extraction', () => ({
  extractStructuredDocument: mocks.extractStructuredDocument,
}));

import { processDecisionRosterOcrJob } from '../../src/modules/jobs/processors/decision-roster-ocr.processor';

const importId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '22222222-2222-4222-8222-222222222222';
const sourceFileId = '33333333-3333-4333-8333-333333333333';

function decisionImport() {
  return {
    id: importId,
    workspaceId,
    sourceFileId,
    sourceFile: {
      id: sourceFileId,
      workspaceId,
      originalName: 'private-roster.pdf',
      mimeType: 'application/pdf',
      storageType: 'r2',
      filePath: 'decision/import.pdf',
    },
    creator: { role: Role.manager },
    createdBy: 'staff-1',
    criterion: Criterion.volunteer,
    convertedValue: 3,
    convertedUnit: 'days',
    status: DecisionImportStatus.uploaded,
  };
}

function job() {
  return { id: 'job-2', targetId: importId, workspaceId, jobType: JobType.decision_roster_ocr } as never;
}

describe('DecisionImport roster OpenAI processor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findImport.mockResolvedValue(decisionImport());
    mocks.updateImport.mockResolvedValue(undefined);
    mocks.deleteTables.mockResolvedValue(undefined);
    mocks.createTable.mockResolvedValue(undefined);
    mocks.deleteRows.mockResolvedValue(undefined);
    mocks.createRows.mockResolvedValue({ count: 1 });
    mocks.getSignedReadUrl.mockResolvedValue('https://storage.test/source.pdf');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    }));
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        decisionImport: { findUnique: mocks.findImport, update: mocks.updateImport },
        decisionTable: { deleteMany: mocks.deleteTables, create: mocks.createTable },
        decisionRosterPreviewRow: { deleteMany: mocks.deleteRows, createMany: mocks.createRows },
      }),
    );
    mocks.extractStructuredDocument.mockResolvedValue({
      data: {
        tables: [{ header: ['MSSV', 'Họ và tên', 'Lớp'], rows: [['00123456', 'Nguyễn An', '23CT1']] }],
      },
      telemetry: { provider: 'openai', useCase: 'decision_roster', requestId: 'req-roster-1' },
    });
  });

  it('extracts a roster to immutable raw tables and creates a preview before confirm', async () => {
    const result = await processDecisionRosterOcrJob(job());

    expect(mocks.extractStructuredDocument).toHaveBeenCalledWith(expect.objectContaining({
      useCase: 'decision_roster',
      model: 'gpt-6-luna',
      schemaName: 'decision_roster_tables',
      content: expect.arrayContaining([
        expect.objectContaining({ type: 'input_file', filename: 'decision-document.pdf' }),
      ]),
    }));
    expect(mocks.createTable).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        headerJson: ['MSSV', 'Họ và tên', 'Lớp'],
        rawTableJson: expect.objectContaining({ header: ['MSSV', 'Họ và tên', 'Lớp'] }),
      }),
    }));
    expect(mocks.createRows).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ studentCode: '00123456', rawRowJson: expect.objectContaining({ MSSV: '00123456' }) })],
    }));
    expect(result).toMatchObject({ previewRowCount: 1, tableCount: 1 });
  });

  it('does not persist a fabricated preview when extraction fails', async () => {
    mocks.extractStructuredDocument.mockRejectedValueOnce(new Error('provider failed'));

    await expect(processDecisionRosterOcrJob(job())).rejects.toThrow('provider failed');
    expect(mocks.createTable).not.toHaveBeenCalled();
    expect(mocks.createRows).not.toHaveBeenCalled();
  });
});

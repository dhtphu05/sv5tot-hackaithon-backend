import { Criterion, DecisionImportStatus, JobType, Role, RosterPreviewValidationStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findImport: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  findCurrent: vi.fn(),
  findRosterJob: vi.fn(),
  updateRosterJob: vi.fn(),
  deleteRows: vi.fn(),
  createRows: vi.fn(),
  auditLog: vi.fn(),
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({
  prisma: { $transaction: mocks.transaction },
}));
vi.mock('../../src/modules/audit/audit.service', () => ({
  AuditService: class { log = mocks.auditLog; },
}));

import { DecisionImportsService } from '../../src/modules/decision-imports/decision-imports.service';

const importId = '11111111-1111-4111-8111-111111111111';
const rowId = '22222222-2222-4222-8222-222222222222';
const workspaceId = '33333333-3333-4333-8333-333333333333';
const rosterJobId = '44444444-4444-4444-8444-444444444444';
const rawRow = { __sourceRowIndex: 1, MSSV: '001234', 'Họ tên': '', Lớp: '23CT1' };

function record(status = DecisionImportStatus.preview_ready) {
  return {
    id: importId,
    workspaceId,
    status,
    sourceFileId: 'source-file',
    rosterJobId,
    metadataJobId: 'metadata-job',
    criterion: Criterion.volunteer,
    convertedValue: 2,
    convertedUnit: 'ngày',
    columnMappingJson: { studentCode: 'MSSV', studentName: 'Họ tên', className: 'Lớp' },
    tables: [{ detectedType: 'roster', rawTableJson: {
      tableIndex: 0,
      header: ['MSSV', 'Họ tên', 'Lớp'],
      rows: [rawRow],
      rawRows: [],
    } }],
    previewRows: [{
      id: rowId,
      studentCode: '001234',
      studentName: null,
      className: '23CT1',
      faculty: null,
      criterion: Criterion.volunteer,
      convertedValue: 2,
      convertedUnit: 'ngày',
      participationStatus: 'confirmed',
      sourcePage: null,
      sourceTableIndex: 0,
      sourceRowIndex: 1,
      validationStatus: RosterPreviewValidationStatus.warning,
      validationWarningsJson: [{ code: 'MISSING_STUDENT_NAME', message: 'Thiếu họ tên sinh viên.' }],
      rawRowJson: rawRow,
    }],
    documents: [],
  };
}

const service = new DecisionImportsService({ findById: mocks.findImport } as never);
const user = { id: 'manager-1', role: Role.manager, workspaceId } as never;

describe('DecisionImport row corrections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findImport.mockResolvedValue(record());
    mocks.findCurrent.mockResolvedValue(record());
    mocks.findRosterJob.mockResolvedValue({ id: rosterJobId, resultJson: { telemetry: { provider: 'openai' } } });
    mocks.updateRosterJob.mockResolvedValue(undefined);
    mocks.deleteRows.mockResolvedValue({ count: 1 });
    mocks.createRows.mockResolvedValue({ count: 1 });
    mocks.queryRaw.mockResolvedValue([{ id: importId }]);
    mocks.auditLog.mockResolvedValue(undefined);
    mocks.transaction.mockImplementation((callback) => callback({
      $queryRaw: mocks.queryRaw,
      decisionImport: { findUnique: mocks.findCurrent },
      indexingJob: { findUnique: mocks.findRosterJob, update: mocks.updateRosterJob },
      decisionRosterPreviewRow: { deleteMany: mocks.deleteRows, createMany: mocks.createRows },
    }));
  });

  it('updates an effective row in the same workspace while preserving OCR raw data', async () => {
    await service.updatePreviewRow(user, importId, rowId, { studentName: 'Nguyễn An' });

    expect(mocks.queryRaw).toHaveBeenCalledOnce();
    expect(mocks.updateRosterJob).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: rosterJobId },
      data: { resultJson: expect.objectContaining({
        telemetry: { provider: 'openai' },
        rowCorrections: { '0:0:1': { studentName: 'Nguyễn An' } },
      }) },
    }));
    expect(mocks.createRows).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({
        studentCode: '001234',
        studentName: 'Nguyễn An',
        validationStatus: RosterPreviewValidationStatus.valid,
        rawRowJson: rawRow,
      })],
    }));
    expect(JSON.stringify(mocks.auditLog.mock.calls)).not.toContain('Nguyễn An');
  });

  it('does not allow a correction on confirmed or cancelled imports', async () => {
    mocks.findImport.mockResolvedValue(record(DecisionImportStatus.confirmed));
    await expect(service.updatePreviewRow(user, importId, rowId, { studentName: 'Nguyễn An' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects a cross-workspace import before opening a transaction', async () => {
    mocks.findImport.mockResolvedValue({ ...record(), workspaceId: 'other-workspace' });
    await expect(service.updatePreviewRow(user, importId, rowId, { studentName: 'Nguyễn An' })).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

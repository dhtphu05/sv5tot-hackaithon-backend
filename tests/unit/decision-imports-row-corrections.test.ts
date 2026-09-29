import { Criterion, DecisionImportStatus, JobStatus, Role, RosterPreviewValidationStatus } from '@prisma/client';
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
  updateImport: vi.fn(),
  findEvent: vi.fn(),
  createEvent: vi.fn(),
  upsertEventFile: vi.fn(),
  deleteParticipants: vi.fn(),
  createParticipants: vi.fn(),
  findSmartReader: vi.fn(),
  auditLog: vi.fn(),
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
    indexingJob: { findUnique: vi.fn() },
    smartReaderJob: { findFirst: mocks.findSmartReader },
  },
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

function record(status: DecisionImportStatus = DecisionImportStatus.preview_ready) {
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
    mocks.findRosterJob.mockResolvedValue({ id: rosterJobId, status: JobStatus.completed, resultJson: { telemetry: { provider: 'openai' } } });
    mocks.updateRosterJob.mockResolvedValue(undefined);
    mocks.deleteRows.mockResolvedValue({ count: 1 });
    mocks.createRows.mockResolvedValue({ count: 1 });
    mocks.queryRaw.mockResolvedValue([{ id: importId }]);
    mocks.updateImport.mockResolvedValue({ id: importId });
    mocks.findEvent.mockResolvedValue(null);
    mocks.createEvent.mockResolvedValue({ id: 'event-1', convertedValue: 2 });
    mocks.upsertEventFile.mockResolvedValue(undefined);
    mocks.deleteParticipants.mockResolvedValue({ count: 0 });
    mocks.createParticipants.mockResolvedValue({ count: 1 });
    mocks.findSmartReader.mockResolvedValue(null);
    mocks.auditLog.mockResolvedValue(undefined);
    mocks.transaction.mockImplementation((callback) => callback({
      $queryRaw: mocks.queryRaw,
      decisionImport: { findUnique: mocks.findCurrent, update: mocks.updateImport },
      indexingJob: { findUnique: mocks.findRosterJob, update: mocks.updateRosterJob },
      decisionRosterPreviewRow: { deleteMany: mocks.deleteRows, createMany: mocks.createRows },
      eventRegistry: { findFirst: mocks.findEvent, create: mocks.createEvent },
      eventFile: { upsert: mocks.upsertEventFile },
      eventParticipant: { deleteMany: mocks.deleteParticipants, createMany: mocks.createParticipants },
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

  it('does not allow corrections after cancellation', async () => {
    mocks.findImport.mockResolvedValue(record(DecisionImportStatus.cancelled));
    await expect(service.updatePreviewRow(user, importId, rowId, { studentName: 'Nguyễn An' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('waits until the roster job is complete before saving a correction overlay', async () => {
    mocks.findRosterJob.mockResolvedValue({ id: rosterJobId, status: JobStatus.processing, resultJson: null });

    await expect(service.updatePreviewRow(user, importId, rowId, { studentName: 'Nguyễn An' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
    });
    expect(mocks.updateRosterJob).not.toHaveBeenCalled();
  });

  it('reverts only the manual overlay and rebuilds values from immutable raw rows', async () => {
    mocks.findImport.mockResolvedValue({
      ...record(),
      previewRows: [{ ...record().previewRows[0], studentName: 'Nguyễn An', validationStatus: RosterPreviewValidationStatus.valid }],
    });
    mocks.findCurrent.mockResolvedValue({
      ...record(),
      previewRows: [{ ...record().previewRows[0], studentName: 'Nguyễn An', validationStatus: RosterPreviewValidationStatus.valid }],
    });
    mocks.findRosterJob.mockResolvedValue({
      id: rosterJobId,
      status: JobStatus.completed,
      resultJson: { telemetry: { provider: 'openai' }, rowCorrections: { '0:0:1': { studentName: 'Nguyễn An' } } },
    });

    await service.revertPreviewRowCorrection(user, importId, rowId);

    expect(mocks.updateRosterJob).toHaveBeenCalledWith(expect.objectContaining({
      data: { resultJson: { telemetry: { provider: 'openai' }, rowCorrections: {} } },
    }));
    expect(mocks.createRows).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({
        studentName: undefined,
        validationStatus: RosterPreviewValidationStatus.warning,
        rawRowJson: rawRow,
      })],
    }));
  });

  it('rejects a cross-workspace import before opening a transaction', async () => {
    mocks.findImport.mockResolvedValue({ ...record(), workspaceId: 'other-workspace' });
    await expect(service.updatePreviewRow(user, importId, rowId, { studentName: 'Nguyễn An' })).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('confirms the preview row loaded after taking the lock shared with corrections', async () => {
    const staleRecord = record();
    const lockedRecord = {
      ...record(),
      previewRows: [{
        ...record().previewRows[0],
        studentName: 'Nguyễn An',
        validationStatus: RosterPreviewValidationStatus.valid,
      }],
    };
    mocks.findImport.mockResolvedValueOnce(staleRecord).mockResolvedValueOnce(lockedRecord);
    mocks.findCurrent.mockResolvedValue(lockedRecord);

    await service.confirm(user, importId, {
      includeWarningRows: false,
      includeInvalidRows: false,
      replaceExistingParticipants: true,
    });

    expect(mocks.queryRaw).toHaveBeenCalledOnce();
    expect(mocks.createParticipants).toHaveBeenCalledWith({
      data: [expect.objectContaining({ studentCode: '001234', studentName: 'Nguyễn An' })],
    });
  });
});

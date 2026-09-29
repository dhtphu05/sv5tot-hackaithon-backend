import { DecisionImportStatus, JobType, Role } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  findCurrent: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  createFile: vi.fn(),
  updateImport: vi.fn(),
  deleteTables: vi.fn(),
  deleteRows: vi.fn(),
  deleteDocuments: vi.fn(),
  findJob: vi.fn(),
  createJob: vi.fn(),
  smartReaderFindFirst: vi.fn(),
  auditLog: vi.fn(),
  uploadObject: vi.fn(),
  deleteObject: vi.fn(),
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
    indexingJob: { findUnique: vi.fn() },
    smartReaderJob: { findFirst: mocks.smartReaderFindFirst },
  },
}));
vi.mock('../../src/modules/audit/audit.service', () => ({
  AuditService: class { log = mocks.auditLog; },
}));
vi.mock('../../src/modules/storage/storage.service', () => ({
  StorageService: class {
    uploadObject = mocks.uploadObject;
    deleteObject = mocks.deleteObject;
  },
}));

import { DecisionImportsService } from '../../src/modules/decision-imports/decision-imports.service';

const importId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '22222222-2222-4222-8222-222222222222';
const metadataJobId = '33333333-3333-4333-8333-333333333333';
const rosterJobId = '44444444-4444-4444-8444-444444444444';
const sourceFileId = '55555555-5555-4555-8555-555555555555';

function record(status: DecisionImportStatus = DecisionImportStatus.draft) {
  return {
    id: importId,
    workspaceId,
    title: 'Quyết định test',
    status,
    sourceFileId: status === DecisionImportStatus.draft ? null : sourceFileId,
    sourceFile: null,
    metadataJobId: null,
    rosterJobId: null,
    documents: [],
    tables: [],
    previewRows: [],
  };
}

const user = { id: 'manager-1', role: Role.manager, workspaceId } as never;
const repository = { findById: mocks.findById };
const service = new DecisionImportsService(repository as never);

function txContext() {
  return {
    $queryRaw: mocks.queryRaw,
    file: { create: mocks.createFile },
    decisionImport: { findUnique: mocks.findCurrent, update: mocks.updateImport },
    decisionTable: { deleteMany: mocks.deleteTables },
    decisionRosterPreviewRow: { deleteMany: mocks.deleteRows },
    decisionDocument: { deleteMany: mocks.deleteDocuments },
    indexingJob: { findFirst: mocks.findJob, create: mocks.createJob },
  };
}

describe('DecisionImport OpenAI file flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findById.mockResolvedValue(record());
    mocks.findCurrent.mockResolvedValue(record());
    mocks.queryRaw.mockResolvedValue([{ id: importId }]);
    mocks.createFile.mockResolvedValue({ id: sourceFileId });
    mocks.updateImport.mockResolvedValue({ id: importId });
    mocks.deleteTables.mockResolvedValue({ count: 0 });
    mocks.deleteRows.mockResolvedValue({ count: 0 });
    mocks.deleteDocuments.mockResolvedValue({ count: 0 });
    mocks.findJob.mockResolvedValue(null);
    mocks.createJob.mockImplementation(async ({ data }) => ({
      id: data.jobType === JobType.decision_metadata ? metadataJobId : rosterJobId,
      ...data,
    }));
    mocks.smartReaderFindFirst.mockResolvedValue(null);
    mocks.auditLog.mockResolvedValue(undefined);
    mocks.uploadObject.mockResolvedValue(undefined);
    mocks.deleteObject.mockResolvedValue(undefined);
    mocks.transaction.mockImplementation((callback) => callback(txContext()));
  });

  it('stores a source file without VNPT upload and clears the previous extraction preview', async () => {
    const file = {
      buffer: Buffer.from('synthetic-pdf'),
      originalname: 'decision.pdf',
      mimetype: 'application/pdf',
      size: 13,
    } as Express.Multer.File;

    await service.uploadFile(user, importId, file);

    expect(mocks.uploadObject).toHaveBeenCalledOnce();
    expect(mocks.createFile).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ workspaceId, mimeType: 'application/pdf' }),
    }));
    expect(mocks.deleteTables).toHaveBeenCalledWith({ where: { decisionImportId: importId } });
    expect(mocks.deleteRows).toHaveBeenCalledWith({ where: { decisionImportId: importId } });
    expect(mocks.deleteDocuments).toHaveBeenCalledWith({ where: { decisionImportId: importId } });
    expect(mocks.updateImport).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        sourceFileId,
        vnptHash: null,
        vnptFileType: null,
        metadataJobId: null,
        rosterJobId: null,
        status: DecisionImportStatus.uploaded,
      }),
    }));
  });

  it('queues metadata and roster jobs without requiring legacy VNPT hashes', async () => {
    mocks.findById.mockResolvedValue({ ...record(DecisionImportStatus.uploaded), sourceFileId });
    mocks.findCurrent.mockResolvedValue({ ...record(DecisionImportStatus.uploaded), sourceFileId });

    await service.start(user, importId, { runMode: 'async' });

    expect(mocks.createJob).toHaveBeenCalledTimes(2);
    expect(mocks.createJob.mock.calls.map(([input]) => input.data.jobType)).toEqual([
      JobType.decision_metadata,
      JobType.decision_roster_ocr,
    ]);
    expect(mocks.updateImport).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        metadataJobId,
        rosterJobId,
        status: DecisionImportStatus.extracting_metadata,
      }),
    }));
  });

  it('does not restart a cancelled import', async () => {
    mocks.findById.mockResolvedValue({ ...record(DecisionImportStatus.cancelled), sourceFileId });

    await expect(service.start(user, importId, { runMode: 'async' })).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

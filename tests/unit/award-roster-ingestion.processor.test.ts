import { AwardDecisionStatus, AwardLevel, FileStorageType, JobType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findDecision: vi.fn(),
  getSignedReadUrl: vi.fn(),
  uploadFile: vi.fn(),
  startAdvancedAsync: vi.fn(),
  getAdvancedAsyncResult: vi.fn(),
  readSheet: vi.fn(),
  createAudit: vi.fn(),
  getMappingContext: vi.fn(),
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({
  prisma: { awardDecision: { findUnique: mocks.findDecision } },
}));
vi.mock('../../src/modules/storage/storage.service', () => ({
  StorageService: class {
    getSignedReadUrl = mocks.getSignedReadUrl;
  },
}));
vi.mock('../../src/modules/applications/application.helpers', () => ({
  createApplicationAudit: mocks.createAudit,
}));
vi.mock('../../src/modules/award-decisions/award-roster.repository', () => ({
  AwardRosterRepository: class {
    getMappingContext = mocks.getMappingContext;
  },
}));
vi.mock('../../src/modules/smartreader', () => ({
  getSmartReaderAdapter: () => ({
    uploadFile: mocks.uploadFile,
    startAdvancedAsync: mocks.startAdvancedAsync,
    getAdvancedAsyncResult: mocks.getAdvancedAsyncResult,
  }),
  mapOcrResponse: vi.fn(),
}));
vi.mock('read-excel-file/node', () => ({ readSheet: mocks.readSheet }));

import { processAwardRosterIngestionJob } from '../../src/modules/jobs/processors/award-roster-ingestion.processor';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const fileId = '22222222-2222-4222-8222-222222222222';
const decisionId = '44444444-4444-4444-8444-444444444444';

function job(inputFileId = fileId) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    targetId: decisionId,
    workspaceId,
    jobType: JobType.award_roster_ingestion,
    inputJson: { rosterFileId: inputFileId, format: 'pdf' },
  } as never;
}

function decision(overrides: Record<string, unknown> = {}) {
  return {
    id: decisionId,
    issuerWorkspaceId: workspaceId,
    awardLevel: AwardLevel.SCHOOL,
    status: AwardDecisionStatus.DRAFT,
    rosterFileId: fileId,
    rosterFile: {
      id: fileId,
      workspaceId,
      originalName: 'roster.pdf',
      mimeType: 'application/pdf',
      storageType: FileStorageType.r2,
      filePath: 'award/roster.pdf',
    },
    ...overrides,
  };
}

describe('Award roster PDF processor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    }));
    mocks.findDecision.mockResolvedValue(decision());
    mocks.getSignedReadUrl.mockResolvedValue('https://storage.example/roster.pdf');
    mocks.uploadFile.mockResolvedValue({ hash: 'smartreader-hash', fileType: 'pdf' });
    mocks.startAdvancedAsync.mockResolvedValue({ sessionId: 'smartreader-session', raw: {} });
    mocks.getAdvancedAsyncResult.mockResolvedValue({
      text: '',
      lines: [],
      paragraphs: [],
      tables: [{ rows: [['MSSV', 'Họ và tên'], ['00123456', 'Nguyễn An']] }],
      warnings: [],
      warningMessages: [],
      status: 'completed',
      raw: {},
    });
    mocks.createAudit.mockResolvedValue(undefined);
    mocks.getMappingContext.mockResolvedValue({
      awardLevel: AwardLevel.SCHOOL,
      issuer: { id: workspaceId, code: 'DUT', name: 'DUT', shortName: 'DUT', aliases: [] },
      institutions: [{ id: workspaceId, code: 'DUT', name: 'DUT', shortName: 'DUT', aliases: [] }],
      users: [],
    });
  });

  it('reuses SmartReader upload, async table OCR, and the existing table normalizer', async () => {
    const result = await processAwardRosterIngestionJob(job());

    expect(mocks.uploadFile).toHaveBeenCalledWith(expect.objectContaining({ originalName: 'roster.pdf' }));
    expect(mocks.startAdvancedAsync).toHaveBeenCalledWith({
      fileHash: 'smartreader-hash',
      fileType: 'pdf',
      details: true,
      exporter: 'json',
    });
    expect(result).toMatchObject({
      format: 'pdf',
      columns: ['MSSV', 'Họ và tên'],
      sourceRows: [['00123456', 'Nguyễn An']],
      rows: [{ studentCode: '00123456', fullName: 'Nguyễn An', status: 'VALID' }],
    });
  });

  it('keeps XLSX date cells non-text so they cannot pass MSSV validation after JSON storage', async () => {
    mocks.findDecision.mockResolvedValueOnce(decision({
      rosterFile: {
        ...decision().rosterFile,
        originalName: 'roster.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    }));
    mocks.readSheet.mockResolvedValueOnce([
      ['MSSV', 'Họ và tên'],
      [new Date('2026-01-02T00:00:00.000Z'), 'Nguyễn An'],
    ]);

    const result = await processAwardRosterIngestionJob(job());

    expect(result).toMatchObject({ rows: [{ status: 'INVALID', studentCode: null, errors: ['STUDENT_CODE_MUST_BE_TEXT'] }] });
  });

  it('propagates SmartReader failures so the indexing job can be marked failed and retried', async () => {
    mocks.getAdvancedAsyncResult.mockResolvedValueOnce({ status: 'failed' });

    await expect(processAwardRosterIngestionJob(job())).rejects.toMatchObject({ statusCode: 502 });
    expect(mocks.createAudit).not.toHaveBeenCalled();
  });

  it('rejects a mismatched job workspace before storage and OCR side effects', async () => {
    mocks.findDecision.mockResolvedValueOnce(decision({ rosterFile: { ...decision().rosterFile, workspaceId: 'other' } }));

    await expect(processAwardRosterIngestionJob(job())).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.getSignedReadUrl).not.toHaveBeenCalled();
    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expect(mocks.startAdvancedAsync).not.toHaveBeenCalled();
  });

  it('rejects an arbitrary file ID before storage and OCR side effects', async () => {
    await expect(processAwardRosterIngestionJob(job('unrelated-file'))).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.getSignedReadUrl).not.toHaveBeenCalled();
    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expect(mocks.startAdvancedAsync).not.toHaveBeenCalled();
  });
});

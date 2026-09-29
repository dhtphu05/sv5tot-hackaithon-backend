import { EventStatus, IndexingStatus, JobStatus, Role } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  findById: vi.fn(),
  eventFindUnique: vi.fn(),
  eventUpdate: vi.fn(),
  eventFileFindFirst: vi.fn(),
  eventFileUpdate: vi.fn(),
  jobFindFirst: vi.fn(),
  jobUpdate: vi.fn(),
  participantDeleteMany: vi.fn(),
  participantUpsert: vi.fn(),
  participantCount: vi.fn(),
  audit: vi.fn(),
  saveFile: vi.fn(),
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({
  prisma: { $transaction: mocks.transaction },
}));
vi.mock('../../src/modules/applications/application.helpers', () => ({
  createApplicationAudit: mocks.audit,
  assertApplicationOwner: vi.fn(),
}));
vi.mock('../../src/modules/storage/storage.service', () => ({
  StorageService: class { saveFile = mocks.saveFile; },
}));

import { EventRegistryService } from '../../src/modules/event-registry/event-registry.service';
import { AppError } from '../../src/shared/errors/app-error';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const eventId = '22222222-2222-4222-8222-222222222222';
const eventFileId = '33333333-3333-4333-8333-333333333333';
const fileId = '44444444-4444-4444-8444-444444444444';
const jobId = '55555555-5555-4555-8555-555555555555';
const user = { id: 'manager-1', role: Role.manager, workspaceId } as never;

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: eventId,
    workspaceId,
    createdBy: 'officer-1',
    rosterIndexed: false,
    status: EventStatus.draft,
    eventName: 'Volunteer event',
    convertedValue: 2,
    convertedUnit: 'days',
    eventFiles: [],
    ...overrides,
  };
}

function completedJob(resultJson = {
  rosterFileId: fileId,
  format: 'csv',
  columns: ['MSSV', 'Họ tên'],
  sourceRows: [{ MSSV: 'old-code', 'Họ tên': 'Raw Name' }],
  rows: [{ MSSV: 'old-code', 'Họ tên': 'Raw Name' }],
  suggestedMapping: {
    studentCode: 'MSSV', studentName: 'Họ tên', className: '', faculty: '', participationStatus: '', convertedValue: '',
  },
  quality: { rowCount: 1, missingStudentCodeRows: 0, missingStudentNameRows: 0, duplicateStudentCodes: [], confidence: 0.9 },
  telemetry: { provider: 'openai' },
  rowCorrections: { '2': { studentCode: 'new-code', studentName: 'Corrected Name' } },
}) {
  return { id: jobId, status: JobStatus.completed, resultJson };
}

const eventFile = {
  id: eventFileId,
  eventId,
  fileId,
  indexingStatus: IndexingStatus.indexed,
  file: { id: fileId, workspaceId },
};

describe('Event Registry scoped roster corrections', () => {
  const repository = { findById: mocks.findById };
  const service = new EventRegistryService(repository as never, { saveFile: mocks.saveFile } as never, {} as never);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findById.mockResolvedValue(event());
    mocks.eventFindUnique.mockResolvedValue(event());
    mocks.eventUpdate.mockResolvedValue({});
    mocks.eventFileFindFirst.mockResolvedValue(eventFile);
    mocks.eventFileUpdate.mockResolvedValue({});
    mocks.jobFindFirst.mockResolvedValue(completedJob());
    mocks.jobUpdate.mockResolvedValue(undefined);
    mocks.participantDeleteMany.mockResolvedValue({ count: 0 });
    mocks.participantUpsert.mockResolvedValue({});
    mocks.participantCount.mockResolvedValue(1);
    mocks.audit.mockResolvedValue(undefined);
    mocks.saveFile.mockResolvedValue({ filePath: 'stored', publicUrl: null });
    mocks.queryRaw.mockResolvedValue([{ id: eventId }]);
    mocks.transaction.mockImplementation((callback) => callback({
      $queryRaw: mocks.queryRaw,
      eventRegistry: { findUnique: mocks.eventFindUnique, update: mocks.eventUpdate },
      eventFile: { findFirst: mocks.eventFileFindFirst, update: mocks.eventFileUpdate },
      indexingJob: { findFirst: mocks.jobFindFirst, update: mocks.jobUpdate },
      eventParticipant: {
        deleteMany: mocks.participantDeleteMany,
        upsert: mocks.participantUpsert,
        count: mocks.participantCount,
      },
    }));
  });

  it('rejects unsupported uploads before persistent storage', async () => {
    await expect(service.uploadRosterFile(user, eventId, {
      buffer: Buffer.from('x'), originalname: 'roster.png', mimetype: 'image/png', size: 1,
    } as never)).rejects.toMatchObject({ code: 'FILE_TYPE_NOT_ALLOWED' });
    expect(mocks.saveFile).not.toHaveBeenCalled();
  });

  it('stores correction overlays on the exact completed event-file job without changing source rows or auditing values', async () => {
    const result = await service.updateRosterPreviewRow(user, eventId, eventFileId, 2, {
      studentCode: 'new-code', studentName: 'Corrected Name', className: '24CT1',
    });

    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
    expect(mocks.eventFileFindFirst).toHaveBeenCalledWith({ where: { id: eventFileId, eventId }, include: { file: true } });
    expect(mocks.jobUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: jobId },
      data: { resultJson: expect.objectContaining({
        sourceRows: [{ MSSV: 'old-code', 'Họ tên': 'Raw Name' }],
        rowCorrections: { '2': { studentCode: 'new-code', studentName: 'Corrected Name', className: '24CT1' } },
      }) },
    }));
    expect(result).toMatchObject({ rowNumber: 2, correction: { studentCode: 'new-code' } });
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain('Corrected Name');
  });

  it('prevents cross-event files and confirmed roster edits', async () => {
    mocks.eventFileFindFirst.mockResolvedValueOnce(null);
    await expect(service.updateRosterPreviewRow(user, eventId, eventFileId, 2, { studentName: 'Changed' })).rejects.toBeInstanceOf(AppError);
    expect(mocks.jobUpdate).not.toHaveBeenCalled();

    mocks.eventFindUnique.mockResolvedValueOnce(event({ rosterIndexed: true }));
    await expect(service.updateRosterPreviewRow(user, eventId, eventFileId, 2, { studentName: 'Changed' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.jobUpdate).not.toHaveBeenCalled();
  });

  it('reverts an overlay while keeping the extracted row and audit value-free', async () => {
    const result = await service.revertRosterPreviewRowCorrection(user, eventId, eventFileId, 2);
    expect(mocks.jobUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: { resultJson: expect.objectContaining({
        sourceRows: [{ MSSV: 'old-code', 'Họ tên': 'Raw Name' }],
        rowCorrections: {},
      }) },
    }));
    expect(result).toMatchObject({ correction: null, sourceRow: { MSSV: 'old-code' } });
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain('Corrected Name');
  });

  it('confirms the effective corrected values under the same Event-then-EventFile lock order', async () => {
    await service.confirmIndex(user, eventId, {
      eventFileId,
      columnMapping: { studentCode: 'MSSV', studentName: 'Họ tên' },
      replaceExisting: true,
    });

    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
    expect(mocks.participantUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ studentCode: 'new-code', studentName: 'Corrected Name', sourceFileId: fileId }),
    }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      afterStateJson: expect.objectContaining({ participantCount: 1, eventFileId }),
    }));
  });
});

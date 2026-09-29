import { FileStorageType, IndexingStatus, JobType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findEventFile: vi.fn(),
  updateEventFile: vi.fn(),
  updateManyEventFile: vi.fn(),
  transaction: vi.fn(),
  createAudit: vi.fn(),
  getSignedReadUrl: vi.fn(),
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

import { processEventRosterIndexingJob } from '../../src/modules/jobs/processors/event-roster-indexing.processor';

const eventFile = {
  id: 'event-file-1',
  eventId: 'event-1',
  file: {
    id: 'file-1',
    originalName: 'roster.csv',
    mimeType: 'text/csv',
    storageType: FileStorageType.local,
    filePath: 'missing-test-file.csv',
  },
  event: {
    id: 'event-1',
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
    vi.clearAllMocks();
    mocks.findEventFile.mockResolvedValue(eventFile);
    mocks.updateEventFile.mockResolvedValue({ ...eventFile, indexingStatus: IndexingStatus.ocr_processing });
    mocks.updateManyEventFile.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(async (callback) =>
      callback({ eventFile: { update: mocks.updateEventFile } }),
    );
  });

  it('fails a CSV read error without inventing roster rows', async () => {
    await expect(processEventRosterIndexingJob(job())).rejects.toMatchObject({
      code: 'ROSTER_PARSE_FAILED',
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.updateManyEventFile).toHaveBeenCalledWith({
      where: { id: eventFile.id, fileId: eventFile.file.id },
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

    await expect(processEventRosterIndexingJob(job())).rejects.toMatchObject({
      code: 'ROSTER_PARSE_FAILED',
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.updateManyEventFile).toHaveBeenCalledWith({
      where: { id: eventFile.id, fileId: eventFile.file.id },
      data: { indexingStatus: IndexingStatus.failed },
    });
    expect(mocks.createAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      afterStateJson: { eventFileId: eventFile.id, code: 'ROSTER_PARSE_FAILED' },
    }));
  });
});

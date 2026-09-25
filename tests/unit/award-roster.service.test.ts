import {
  AwardDecisionStatus,
  AwardLevel,
  JobStatus,
  Role,
  WorkspaceType,
} from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AwardRosterService } from '../../src/modules/award-decisions/award-roster.service';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const otherWorkspaceId = '22222222-2222-4222-8222-222222222222';

function uploader(overrides: Record<string, unknown> = {}) {
  return {
    id: 'uploader-1',
    role: Role.data_uploader,
    workspaceId,
    email: 'uploader@example.test',
    fullName: 'Uploader',
    studentCode: null,
    className: null,
    faculty: null,
    avatarUrl: null,
    workspace: { id: workspaceId, type: WorkspaceType.SCHOOL },
    ...overrides,
  } as never;
}

function decision(overrides: Record<string, unknown> = {}) {
  return {
    id: 'decision-1',
    issuerWorkspaceId: workspaceId,
    awardLevel: AwardLevel.SCHOOL,
    status: AwardDecisionStatus.DRAFT,
    rosterFileId: 'file-current',
    rosterFile: {
      id: 'file-current',
      workspaceId,
      originalName: 'roster.csv',
      mimeType: 'text/csv',
      storageType: 'local',
      filePath: 'roster.csv',
      fileSize: 10,
    },
    issuerWorkspace: { id: workspaceId, type: WorkspaceType.SCHOOL },
    ...overrides,
  };
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: 'internal-job-id',
    targetId: 'decision-1',
    workspaceId,
    status: JobStatus.completed,
    inputJson: { rosterFileId: 'file-current', format: 'csv' },
    resultJson: {
      rosterFileId: 'file-current',
      columns: ['MSSV', 'Họ và tên'],
      sourceRows: [['00123456', 'Nguyễn An']],
      suggestedMapping: { studentCode: 'MSSV', fullName: 'Họ và tên' },
      mapping: { studentCode: 'MSSV', fullName: 'Họ và tên' },
      rows: [{ studentCode: '00123456', fullName: 'Nguyễn An', status: 'VALID', matchedUserId: 'student-1' }],
      summary: { total: 1, valid: 1, invalid: 0, duplicate: 0, conflict: 0, matched: 1, unmatched: 0 },
    },
    ...overrides,
  };
}

function buildService() {
  const repository = {
    findDecision: vi.fn().mockResolvedValue(decision()),
    findLatestJob: vi.fn().mockResolvedValue(null),
    createJob: vi.fn().mockResolvedValue({ id: 'internal-job-id' }),
    retryJob: vi.fn(),
    getMappingContext: vi.fn().mockResolvedValue({
      awardLevel: AwardLevel.SCHOOL,
      issuer: { id: workspaceId, code: 'DUT', name: 'DUT', shortName: 'DUT', aliases: [] },
      institutions: [{ id: workspaceId, code: 'DUT', name: 'DUT', shortName: 'DUT', aliases: [] }],
      users: [{ id: 'student-1', studentCode: '00123456', workspaceId }],
    }),
    updatePreview: vi.fn(),
    confirm: vi.fn().mockResolvedValue({ recipientCount: 1 }),
    listRecipients: vi.fn().mockResolvedValue({ items: [{ id: 'recipient-1', studentCode: '00123456', matchStatus: 'MATCHED' }], total: 1 }),
  };
  const auditService = { log: vi.fn().mockResolvedValue(undefined) };
  return {
    service: new AwardRosterService(repository as never, auditService as never),
    repository,
    auditService,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('AwardRosterService', () => {
  it('queues processing without exposing the generic job identifier', async () => {
    const { service, repository } = buildService();

    const response = await service.processRoster(uploader(), 'decision-1');

    expect(repository.createJob).toHaveBeenCalledWith({
      decisionId: 'decision-1',
      workspaceId,
      rosterFileId: 'file-current',
      format: 'csv',
    });
    expect(response).toEqual({ status: 'processing' });
    expect(JSON.stringify(response)).not.toContain('internal-job-id');
  });

  it('scopes decision lookup to the uploader workspace and creates no job for an IDOR', async () => {
    const { service, repository, auditService } = buildService();
    repository.findDecision.mockResolvedValue(null);

    await expect(service.processRoster(uploader(), 'decision-b')).rejects.toMatchObject({ statusCode: 404 });

    expect(repository.findDecision).toHaveBeenCalledWith('decision-b', workspaceId);
    expect(repository.createJob).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it('rejects unsupported legacy XLS before queueing', async () => {
    const { service, repository } = buildService();
    repository.findDecision.mockResolvedValue(decision({
      rosterFile: { ...decision().rosterFile, originalName: 'roster.xls', mimeType: 'application/vnd.ms-excel' },
    }));

    await expect(service.processRoster(uploader(), 'decision-1')).rejects.toMatchObject({ statusCode: 400 });
    expect(repository.createJob).not.toHaveBeenCalled();
  });

  it('retries a failed job only for the still-current roster file', async () => {
    const { service, repository } = buildService();
    repository.findLatestJob.mockResolvedValueOnce(job({ status: JobStatus.failed }) as never);
    repository.retryJob.mockResolvedValueOnce(job({ status: JobStatus.queued }) as never);

    await expect(service.processRoster(uploader(), 'decision-1')).resolves.toEqual({ status: 'processing' });

    expect(repository.retryJob).toHaveBeenCalledWith('internal-job-id', 'decision-1', workspaceId);
    expect(repository.createJob).not.toHaveBeenCalled();
  });

  it('invalidates old processing results after the roster is replaced', async () => {
    const { service, repository } = buildService();
    repository.findDecision.mockResolvedValue(decision({ rosterFileId: 'file-new', rosterFile: { ...decision().rosterFile, id: 'file-new' } }));
    repository.findLatestJob.mockResolvedValueOnce(job() as never);

    await expect(service.getProcessing(uploader(), 'decision-1')).resolves.toEqual({ status: 'not_started' });
    await expect(service.getPreview(uploader(), 'decision-1', { page: 1, limit: 20 })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('paginates safe preview rows and does not expose matchedUserId', async () => {
    const { service, repository } = buildService();
    repository.findLatestJob.mockResolvedValueOnce(job({
      resultJson: {
        ...job().resultJson,
        rows: Array.from({ length: 25 }, (_, index) => ({
          sourceRow: index + 2,
          studentCode: `0000${index}`,
          fullName: `Student ${index}`,
          status: 'VALID',
          matchedUserId: 'private-user-id',
        })),
      },
    }) as never);

    const result = await service.getPreview(uploader(), 'decision-1', { page: 2, limit: 20 });

    expect(result.items).toHaveLength(5);
    expect(result.pagination).toMatchObject({ page: 2, limit: 20, total: 25, totalPages: 2 });
    expect(JSON.stringify(result)).not.toContain('private-user-id');
  });

  it('recomputes mapping and validation from raw rows before updating the preview', async () => {
    const { service, repository } = buildService();
    repository.findLatestJob.mockResolvedValueOnce(job() as never);

    const result = await service.updateMapping(uploader(), 'decision-1', {
      studentCode: 'MSSV',
      fullName: 'Họ và tên',
    });

    expect(repository.updatePreview).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'internal-job-id',
        decisionId: 'decision-1',
        issuerWorkspaceId: workspaceId,
        rosterFileId: 'file-current',
        resultJson: expect.objectContaining({ summary: expect.objectContaining({ valid: 1, matched: 1 }) }),
      }),
    );
    expect(result.validationSummary.valid).toBe(1);
  });

  it('rejects invalid mappings before saving a modified preview', async () => {
    const { service, repository } = buildService();
    repository.findLatestJob.mockResolvedValueOnce(job() as never);

    await expect(service.updateMapping(uploader(), 'decision-1', {
      studentCode: 'MSSV',
      fullName: 'MSSV',
    })).rejects.toMatchObject({ statusCode: 400 });
    expect(repository.updatePreview).not.toHaveBeenCalled();
  });

  it('scopes processing, status, preview, mapping, confirmation, and recipient reads to the issuer workspace', async () => {
    const { service, repository } = buildService();
    repository.findDecision.mockResolvedValue(null);
    const otherUploader = uploader({ workspaceId: otherWorkspaceId, workspace: { id: otherWorkspaceId, type: WorkspaceType.SCHOOL } });

    await expect(service.processRoster(otherUploader, 'decision-b')).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.getProcessing(otherUploader, 'decision-b')).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.getPreview(otherUploader, 'decision-b', { page: 1, limit: 20 })).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.updateMapping(otherUploader, 'decision-b', { studentCode: 'MSSV', fullName: 'Họ và tên' }))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(service.confirm(otherUploader, 'decision-b')).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.listRecipients(otherUploader, 'decision-b', { page: 1, limit: 20 }))
      .rejects.toMatchObject({ statusCode: 404 });

    expect(repository.findDecision).toHaveBeenCalledTimes(6);
    expect(repository.findDecision).toHaveBeenCalledWith('decision-b', otherWorkspaceId);
    expect(repository.createJob).not.toHaveBeenCalled();
    expect(repository.updatePreview).not.toHaveBeenCalled();
    expect(repository.confirm).not.toHaveBeenCalled();
    expect(repository.listRecipients).not.toHaveBeenCalled();
  });

  it('confirms only through the scoped repository transaction', async () => {
    const { service, repository } = buildService();

    await expect(service.confirm(uploader(), 'decision-1')).resolves.toEqual({ recipientCount: 1 });

    expect(repository.confirm).toHaveBeenCalledWith({
      decisionId: 'decision-1',
      issuerWorkspaceId: workspaceId,
      actor: uploader(),
    });
  });

  it('lists recipients without returning account identifiers', async () => {
    const { service, repository } = buildService();
    repository.findDecision.mockResolvedValue(decision({ status: AwardDecisionStatus.CONFIRMED }) as never);

    const result = await service.listRecipients(uploader(), 'decision-1', { page: 1, limit: 20 });

    expect(repository.listRecipients).toHaveBeenCalledWith({ decisionId: 'decision-1', page: 1, limit: 20 });
    expect(JSON.stringify(result)).not.toContain('matchedUserId');
    expect(JSON.stringify(result)).not.toContain('private-user-id');
  });

  it('rejects a City uploader before querying the registry', async () => {
    const { service, repository } = buildService();

    await expect(
      service.processRoster(uploader({ workspace: { id: workspaceId, type: WorkspaceType.CITY } }), 'decision-1'),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.findDecision).not.toHaveBeenCalled();
  });

  it('does not let an assigned uploader move between issuer workspaces', async () => {
    const { service, repository } = buildService();
    repository.findDecision.mockResolvedValue(null);

    await expect(service.getProcessing(uploader({ workspaceId: otherWorkspaceId, workspace: { id: otherWorkspaceId, type: WorkspaceType.SCHOOL } }), 'decision-1'))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(repository.findDecision).toHaveBeenCalledWith('decision-1', otherWorkspaceId);
  });
});

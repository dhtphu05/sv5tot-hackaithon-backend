import {
  AwardDecisionStatus,
  AwardLevel,
  Role,
  WorkspaceType,
} from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AwardDecisionsService } from '../../src/modules/award-decisions/award-decisions.service';

const schoolWorkspaceId = '11111111-1111-4111-8111-111111111111';
const universityWorkspaceId = '22222222-2222-4222-8222-222222222222';
const cityWorkspaceId = '33333333-3333-4333-8333-333333333333';

function user(
  role: Role,
  workspaceId: string | null = schoolWorkspaceId,
  type: WorkspaceType = WorkspaceType.SCHOOL,
) {
  return {
    id: `${role}-user`,
    workspaceId,
    email: `${role}@example.test`,
    role,
    fullName: role,
    studentCode: null,
    className: null,
    faculty: null,
    avatarUrl: null,
    workspace: workspaceId ? { id: workspaceId, code: 'DUT', type, name: 'DUT', shortName: 'DUT' } : null,
  } as never;
}

function decision(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-09-24T00:00:00.000Z');
  return {
    id: 'decision-1',
    issuerWorkspaceId: schoolWorkspaceId,
    awardLevel: AwardLevel.SCHOOL,
    schoolYear: '2025-2026',
    decisionNumber: null,
    decisionDate: null,
    decisionFile: null,
    rosterFile: null,
    sourceImportId: null,
    status: AwardDecisionStatus.DRAFT,
    createdById: 'data_uploader-user',
    confirmedById: null,
    confirmedAt: null,
    createdAt: now,
    updatedAt: now,
    issuerWorkspace: { id: schoolWorkspaceId, code: 'DUT', name: 'DUT', shortName: 'DUT', type: WorkspaceType.SCHOOL },
    _count: { recipients: 0 },
    ...overrides,
  };
}

function buildService() {
  const repository = {
    list: vi.fn().mockResolvedValue({ items: [decision()], total: 1 }),
    findById: vi.fn().mockResolvedValue(decision()),
    findWorkspaceById: vi.fn(),
    create: vi.fn().mockResolvedValue(decision()),
    update: vi.fn().mockResolvedValue(decision()),
    attachFile: vi.fn().mockResolvedValue({ decision: decision(), fileId: 'file-1' }),
  };
  const storageService = {
    saveFile: vi.fn().mockResolvedValue({ filePath: 'award-decisions/decision-1/decision/file.pdf', publicUrl: null }),
    deleteObject: vi.fn(),
  };
  const auditService = { log: vi.fn().mockResolvedValue(undefined) };
  const service = new AwardDecisionsService(repository as never, storageService as never, auditService as never);
  return { service, repository, storageService, auditService };
}

beforeEach(() => vi.clearAllMocks());

describe('AwardDecisionsService', () => {
  it('scopes uploader lists to their workspace even when a tenant filter is supplied', async () => {
    const { service, repository } = buildService();
    const query = { page: 1, limit: 20, issuerWorkspaceId: universityWorkspaceId };

    await service.list(user(Role.data_uploader), query);

    expect(repository.list).toHaveBeenCalledWith(schoolWorkspaceId, {
      ...query,
      issuerWorkspaceId: undefined,
    });
  });

  it('lets admins list the global registry with an optional issuer filter', async () => {
    const { service, repository } = buildService();
    const query = { page: 1, limit: 20, issuerWorkspaceId: universityWorkspaceId };

    await service.list(user(Role.admin, null), query);

    expect(repository.list).toHaveBeenCalledWith(undefined, query);
  });

  it('derives the school award level from the uploader workspace', async () => {
    const { service, repository } = buildService();

    await service.create(user(Role.data_uploader), { schoolYear: '2025-2026' });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        issuerWorkspaceId: schoolWorkspaceId,
        awardLevel: AwardLevel.SCHOOL,
        status: AwardDecisionStatus.DRAFT,
      }),
    );
  });

  it('derives university system award level and requires explicit admin issuer', async () => {
    const { service, repository } = buildService();
    await service.create(user(Role.data_uploader, universityWorkspaceId, WorkspaceType.UNIVERSITY_SYSTEM), {
      schoolYear: '2025-2026',
    });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ issuerWorkspaceId: universityWorkspaceId, awardLevel: AwardLevel.UNIVERSITY_SYSTEM }),
    );

    const admin = user(Role.admin, null);
    await expect(service.create(admin, { schoolYear: '2025-2026' })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('lets an admin create for a selected school workspace and rejects a city issuer', async () => {
    const { service, repository } = buildService();
    repository.findWorkspaceById
      .mockResolvedValueOnce({ id: schoolWorkspaceId, type: WorkspaceType.SCHOOL })
      .mockResolvedValueOnce({ id: cityWorkspaceId, type: WorkspaceType.CITY });

    await service.create(user(Role.admin, null), {
      issuerWorkspaceId: schoolWorkspaceId,
      schoolYear: '2025-2026',
    });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ issuerWorkspaceId: schoolWorkspaceId, awardLevel: AwardLevel.SCHOOL }),
    );
    await expect(
      service.create(user(Role.admin, null), {
        issuerWorkspaceId: cityWorkspaceId,
        schoolYear: '2025-2026',
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('denies a City data uploader and students', async () => {
    const { service, repository } = buildService();
    const cityUploader = user(Role.data_uploader, cityWorkspaceId, WorkspaceType.CITY);

    await expect(service.list(cityUploader, { page: 1, limit: 20 })).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(service.list(user(Role.student), { page: 1, limit: 20 })).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repository.list).not.toHaveBeenCalled();
  });

  it('hides decisions from another workspace before metadata update', async () => {
    const { service, repository, auditService } = buildService();
    repository.findById.mockResolvedValue(null);

    await expect(
      service.update(user(Role.data_uploader), 'decision-b', { schoolYear: '2026-2027' }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(repository.update).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it('does not update a confirmed decision', async () => {
    const { service, repository, auditService } = buildService();
    repository.findById.mockResolvedValue(decision({ status: AwardDecisionStatus.CONFIRMED }));

    await expect(
      service.update(user(Role.data_uploader), 'decision-1', { schoolYear: '2026-2027' }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(repository.update).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it('checks workspace and file kind before storing or associating a file', async () => {
    const { service, repository, storageService } = buildService();
    repository.findById.mockResolvedValue(null);
    const file = { buffer: Buffer.from('file'), originalname: 'decision.pdf', mimetype: 'application/pdf', size: 4 } as Express.Multer.File;

    await expect(service.uploadFile(user(Role.data_uploader), 'decision-b', 'decision', file)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(storageService.saveFile).not.toHaveBeenCalled();

    repository.findById.mockResolvedValue(decision());
    await expect(service.uploadFile(user(Role.data_uploader), 'decision-1', 'decision', {
      ...file,
      mimetype: 'text/csv',
    })).rejects.toMatchObject({ statusCode: 400 });
    expect(storageService.saveFile).not.toHaveBeenCalled();
  });

  it('stores an authorized draft file in its issuer workspace without starting jobs', async () => {
    const { service, repository, storageService, auditService } = buildService();
    const file = {
      buffer: Buffer.from('file'),
      originalname: 'decision.pdf',
      mimetype: 'application/pdf',
      size: 4,
    } as Express.Multer.File;

    await service.uploadFile(user(Role.data_uploader), 'decision-1', 'decision', file);

    expect(storageService.saveFile).toHaveBeenCalledWith(
      expect.objectContaining({ directory: 'award-decisions/decision-1/decision' }),
    );
    expect(repository.attachFile).toHaveBeenCalledWith(
      expect.objectContaining({
        issuerWorkspaceId: schoolWorkspaceId,
        kind: 'decision',
        ownerId: 'data_uploader-user',
      }),
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AWARD_DECISION_FILE_UPLOADED', workspaceId: schoolWorkspaceId }),
    );
  });
});

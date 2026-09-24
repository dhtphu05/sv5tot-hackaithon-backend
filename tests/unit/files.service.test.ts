import { Role } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  officerSpecialization: { findFirst: vi.fn() },
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({ prisma: prismaMock }));

import { FilesService } from '../../src/modules/files/files.service';
import { FilesRepository } from '../../src/modules/files/files.repository';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const otherWorkspaceId = '22222222-2222-4222-8222-222222222222';
const evidenceId = '33333333-3333-4333-8333-333333333333';

beforeEach(() => vi.clearAllMocks());

function user(role: Role, overrides: Record<string, unknown> = {}) {
  return {
    id: `${role}-user`,
    email: `${role}@example.test`,
    role,
    fullName: `${role} user`,
    studentCode: role === Role.student ? '102220001' : null,
    className: null,
    faculty: null,
    workspaceId,
    workspace: { id: workspaceId, code: 'DUT', type: 'SCHOOL', name: 'DUT', shortName: 'DUT' },
    ...overrides,
  } as never;
}

function cityOfficer() {
  const cityId = 'city-workspace';
  return user(Role.city_officer, {
    workspaceId: cityId,
    workspace: {
      id: cityId,
      code: 'DANANG_CITY',
      type: 'CITY',
      name: 'Da Nang',
      shortName: 'Da Nang',
    },
  });
}

function eventSourceFile(fileWorkspaceId = workspaceId) {
  return {
    id: 'file-1',
    workspaceId: fileWorkspaceId,
    ownerId: 'uploader-1',
    storageType: 'local',
    filePath: 'event-rosters/file-1.pdf',
    originalName: 'decision.pdf',
    mimeType: 'application/pdf',
    fileSize: 1234,
    publicUrl: null,
    evidenceFiles: [],
    eventFiles: [{ event: { workspaceId: fileWorkspaceId } }],
    decisionImports: [],
    sampleCertificateEvents: [],
    awardDecisionsAsDecisionFile: [],
    awardDecisionsAsRosterFile: [],
  };
}

function serviceFor(file: ReturnType<typeof eventSourceFile>) {
  const repository = {
    findById: vi.fn().mockResolvedValue(file),
  };
  const storage = {
    getSignedReadUrl: vi.fn().mockResolvedValue('https://signed.example/file-1'),
  };
  return {
    service: new FilesService(repository as never, storage as never),
    repository,
    storage,
  };
}

describe('FilesService event source signed URLs', () => {
  it('allows a data uploader to open Award Decision files in their own workspace only', async () => {
    const file = {
      ...eventSourceFile(),
      eventFiles: [],
      awardDecisionsAsDecisionFile: [{ issuerWorkspaceId: workspaceId }],
    } as never;
    const { service, storage } = serviceFor(file);
    const uploader = user(Role.data_uploader);

    await expect(service.getSignedUrl(uploader, 'file-1')).resolves.toBe(
      'https://signed.example/file-1',
    );
    expect(storage.getSignedReadUrl).toHaveBeenCalledOnce();
  });

  it('does not grant a data uploader workspace-wide access to unrelated files', async () => {
    const file = {
      ...eventSourceFile(),
      ownerId: 'data_uploader-user',
      eventFiles: [],
      awardDecisionsAsDecisionFile: [],
      awardDecisionsAsRosterFile: [],
    } as never;
    const { service, storage } = serviceFor(file);
    const uploader = user(Role.data_uploader);

    await expect(service.getSignedUrl(uploader, 'file-1')).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(storage.getSignedReadUrl).not.toHaveBeenCalled();
  });

  it('allows officers to open official event source files in their workspace', async () => {
    const { service, storage } = serviceFor(eventSourceFile());

    await expect(service.getSignedUrl(user(Role.officer), 'file-1')).resolves.toBe(
      'https://signed.example/file-1',
    );
    expect(storage.getSignedReadUrl).toHaveBeenCalledWith('event-rosters/file-1.pdf', 300, 'local');
  });

  it('allows a specialized City Officer to download School evidence for cross-school review', async () => {
    const file = {
      ...eventSourceFile(otherWorkspaceId),
      filePath: 'evidence/evidence-a.pdf',
      eventFiles: [],
    evidenceFiles: [
        {
          evidence: {
            id: evidenceId,
            criterion: 'academic',
            assignedOfficerId: null,
            application: {
              workspaceId: otherWorkspaceId,
              workspace: { type: 'SCHOOL', isActive: true },
              student: { faculty: 'Faculty B' },
              reviewTasks: [
                {
                  id: 'task-1',
                  criterion: 'academic',
                  assignedOfficerId: 'city_officer-user',
                  status: 'accepted',
                  evidences: [{ evidenceId }],
                },
              ],
            },
          },
        },
      ],
    } as never;
    const { service, storage } = serviceFor(file);
    prismaMock.officerSpecialization.findFirst.mockResolvedValue({ id: 'spec-city' });

    await expect(service.getSignedUrl(cityOfficer(), 'file-1')).resolves.toBe(
      'https://signed.example/file-1',
    );
    expect(prismaMock.officerSpecialization.findFirst).toHaveBeenCalledWith({
      where: {
        officerId: 'city_officer-user',
        criterion: 'academic',
        isActive: true,
        officer: { role: Role.city_officer, isActive: true, workspaceId: 'city-workspace' },
      },
    });
    expect(storage.getSignedReadUrl).toHaveBeenCalled();
  });

  it.each([
    {
      name: 'a waiting task',
      task: {
        criterion: 'academic',
        assignedOfficerId: 'city_officer-user',
        status: 'waiting',
        evidences: [{ evidenceId }],
      },
    },
    {
      name: 'a task assigned to another officer',
      task: {
        criterion: 'academic',
        assignedOfficerId: 'other-officer',
        status: 'accepted',
        evidences: [{ evidenceId }],
      },
    },
    {
      name: 'a task linked to a different evidence',
      task: {
        criterion: 'academic',
        assignedOfficerId: 'city_officer-user',
        status: 'accepted',
        evidences: [{ evidenceId: '44444444-4444-4444-8444-444444444444' }],
      },
    },
  ])('denies City Officer evidence access with $name', async ({ task }) => {
    const file = {
      ...eventSourceFile(otherWorkspaceId),
      filePath: 'evidence/evidence-a.pdf',
      eventFiles: [],
      evidenceFiles: [
        {
          evidence: {
            id: evidenceId,
            criterion: 'academic',
            application: {
              workspaceId: otherWorkspaceId,
              workspace: { type: 'SCHOOL', isActive: true },
              reviewTasks: [task],
            },
          },
        },
      ],
    } as never;
    const { service, storage } = serviceFor(file);
    prismaMock.officerSpecialization.findFirst.mockResolvedValue({ id: 'spec-city' });

    await expect(service.getSignedUrl(cityOfficer(), 'file-1')).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(storage.getSignedReadUrl).not.toHaveBeenCalled();
  });

  it('does not let file ownership bypass City Officer evidence-task scope', async () => {
    const file = {
      ...eventSourceFile(otherWorkspaceId),
      ownerId: 'city_officer-user',
      filePath: 'evidence/evidence-a.pdf',
      eventFiles: [],
      evidenceFiles: [
        {
          evidence: {
            id: evidenceId,
            criterion: 'academic',
            application: {
              workspaceId: otherWorkspaceId,
              workspace: { type: 'SCHOOL', isActive: true },
              reviewTasks: [
                {
                  criterion: 'academic',
                  assignedOfficerId: 'city_officer-user',
                  status: 'waiting',
                  evidences: [{ evidenceId }],
                },
              ],
            },
          },
        },
      ],
    } as never;
    const { service, storage } = serviceFor(file);

    await expect(service.getSignedUrl(cityOfficer(), 'file-1')).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(storage.getSignedReadUrl).not.toHaveBeenCalled();
  });

  it('allows a City Officer to open linked collective evidence after their final review', async () => {
    const file = {
      ...eventSourceFile(otherWorkspaceId),
      filePath: 'evidence/collective-evidence.pdf',
      eventFiles: [],
      evidenceFiles: [
        {
          evidence: {
            id: evidenceId,
            criterion: 'volunteer',
            collectiveProfile: {
              workspaceId: otherWorkspaceId,
              workspace: { type: 'SCHOOL', isActive: true },
              reviewTasks: [
                {
                  criterion: 'volunteer',
                  assignedOfficerId: 'city_officer-user',
                  status: 'rejected',
                  evidences: [{ evidenceId }],
                },
              ],
            },
          },
        },
      ],
    } as never;
    const { service, storage } = serviceFor(file);
    prismaMock.officerSpecialization.findFirst.mockResolvedValue({ id: 'spec-city' });

    await expect(service.getSignedUrl(cityOfficer(), 'file-1')).resolves.toBe(
      'https://signed.example/file-1',
    );
    expect(storage.getSignedReadUrl).toHaveBeenCalled();
  });

  it('denies a City Officer cross-school evidence without a corresponding review task', async () => {
    const file = {
      ...eventSourceFile(otherWorkspaceId),
      filePath: 'evidence/evidence-a.pdf',
      eventFiles: [],
      evidenceFiles: [
        {
          evidence: {
            criterion: 'academic',
            assignedOfficerId: null,
            application: {
              workspaceId: otherWorkspaceId,
              workspace: { type: 'SCHOOL', isActive: true },
              student: { faculty: 'Faculty B' },
              reviewTasks: [],
            },
          },
        },
      ],
    } as never;
    const { service, storage } = serviceFor(file);
    prismaMock.officerSpecialization.findFirst.mockResolvedValue({ id: 'spec-city' });

    await expect(service.getSignedUrl(cityOfficer(), 'file-1')).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(storage.getSignedReadUrl).not.toHaveBeenCalled();
  });

  it('does not let students open event source files through signed URLs', async () => {
    const { service, storage } = serviceFor(eventSourceFile());

    await expect(service.getSignedUrl(user(Role.student), 'file-1')).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(storage.getSignedReadUrl).not.toHaveBeenCalled();
  });

  it('does not let officers open cross-workspace event source files', async () => {
    const { service, storage } = serviceFor(eventSourceFile(otherWorkspaceId));

    await expect(service.getSignedUrl(user(Role.officer), 'file-1')).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(storage.getSignedReadUrl).not.toHaveBeenCalled();
  });
});

describe('FilesRepository evidence review links', () => {
  it('loads exact evidence links through both individual and collective review tasks', async () => {
    const db = { file: { findUnique: vi.fn().mockResolvedValue(null) } };
    await new FilesRepository(db as never).findById('file-1');

    expect(db.file.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          evidenceFiles: {
            include: {
              evidence: {
                include: expect.objectContaining({
                  application: {
                    include: expect.objectContaining({
                      reviewTasks: {
                        include: { evidences: { select: { evidenceId: true } } },
                      },
                    }),
                  },
                  collectiveProfile: {
                    include: expect.objectContaining({
                      reviewTasks: {
                        include: { evidences: { select: { evidenceId: true } } },
                      },
                    }),
                  },
                }),
              },
            },
          },
        }),
      }),
    );
  });
});

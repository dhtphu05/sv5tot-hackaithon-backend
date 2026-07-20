import { Role } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { FilesService } from '../../src/modules/files/files.service';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const otherWorkspaceId = '22222222-2222-4222-8222-222222222222';

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
    ...overrides,
  } as never;
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
  it('allows officers to open official event source files in their workspace', async () => {
    const { service, storage } = serviceFor(eventSourceFile());

    await expect(service.getSignedUrl(user(Role.officer), 'file-1')).resolves.toBe(
      'https://signed.example/file-1',
    );
    expect(storage.getSignedReadUrl).toHaveBeenCalledWith('event-rosters/file-1.pdf', 300, 'local');
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

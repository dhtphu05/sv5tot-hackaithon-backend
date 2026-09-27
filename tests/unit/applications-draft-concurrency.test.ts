import { ApplicationStatus, Level, Role } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({ $transaction: vi.fn() }));

vi.mock('../../src/infrastructure/database/prisma', () => ({ prisma: prismaMock }));

import { ApplicationsService } from '../../src/modules/applications/applications.service';
import type { AuthenticatedUser } from '../../src/shared/types/auth';

const student = {
  id: 'student-a',
  workspaceId: 'school-a',
  email: 'student-a@example.test',
  role: Role.student,
  fullName: 'Student A',
  studentCode: '000123',
  className: '24CTT1',
  faculty: null,
  avatarUrl: null,
  workspace: { id: 'school-a', type: 'SCHOOL' },
} as unknown as AuthenticatedUser;

function application() {
  return {
    id: 'application-a',
    workspaceId: 'school-a',
    studentId: 'student-a',
    schoolYear: '2025-2026',
    status: ApplicationStatus.draft,
    targetLevel: Level.school,
    currentDraftVersion: 4,
    submittedAt: null,
  };
}

function buildService() {
  const tx = {
    application: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    applicationDraftSnapshot: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  const repository = {
    findBareById: vi.fn().mockResolvedValue(application()),
  };
  prismaMock.$transaction.mockImplementation(async (callback) => callback(tx));
  return { service: new ApplicationsService(repository as never), tx };
}

describe('ApplicationsService draft write concurrency', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a target-level change if the application changed after the draft was read', async () => {
    const { service, tx } = buildService();

    await expect(
      service.updateTargetLevel(student, 'application-a', { targetLevel: Level.city }),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(tx.application.updateMany).toHaveBeenCalledOnce();
    expect(tx.applicationDraftSnapshot.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects autosave if submit has locked the application since the draft was read', async () => {
    const { service, tx } = buildService();

    await expect(
      service.autosaveDraft(student, 'application-a', { targetLevel: Level.city } as never),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(tx.application.updateMany).toHaveBeenCalledOnce();
    expect(tx.applicationDraftSnapshot.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});

import { ApplicationStatus, ApplicationType, FinalStatus, Level, Role } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../src/shared/types/auth';

const prismaMock = vi.hoisted(() => ({ $transaction: vi.fn() }));

vi.mock('../../src/infrastructure/database/prisma', () => ({ prisma: prismaMock }));

import { ApplicationsService } from '../../src/modules/applications/applications.service';
import { startApplicationSchema } from '../../src/modules/applications/applications.validation';
import { normalizeSchoolYear } from '../../src/shared/utils/school-year';

const student = {
  id: 'student-a',
  workspaceId: 'school-a',
  role: Role.student,
  fullName: 'Student A',
  studentCode: '000123',
  className: '24CTT1',
  faculty: null,
} as unknown as AuthenticatedUser;

const admin = { ...student, id: 'admin-a', role: Role.admin } as AuthenticatedUser;

function responseApplication(overrides: Record<string, unknown> = {}) {
  return {
    id: 'application-a',
    schoolYear: normalizeSchoolYear(undefined),
    applicationType: ApplicationType.individual,
    targetLevel: Level.city,
    status: ApplicationStatus.draft,
    readinessScore: 0,
    currentDraftVersion: 1,
    submittedAt: null,
    finalLevel: null,
    finalStatus: FinalStatus.pending,
    finalNote: null,
    finalizedAt: null,
    finalizedBy: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    metrics: [],
    evidences: [],
    reviewTasks: [],
    draftSnapshots: [],
    precheckResults: [],
    cascadeReviews: [],
    _count: { evidences: 0 },
    ...overrides,
  };
}

function buildService(input: { existing?: unknown; bare?: unknown } = {}) {
  const tx = {
    application: {
      findUnique: vi.fn().mockResolvedValue(input.existing ?? null),
      create: vi.fn().mockResolvedValue({ id: 'application-a' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    applicationDraftSnapshot: { create: vi.fn().mockResolvedValue({}) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'application-a', cancelledAt: null }]),
  };
  const repository = {
    findById: vi.fn().mockResolvedValue(responseApplication()),
    findBareById: vi.fn().mockResolvedValue(
      input.bare ?? {
        id: 'application-a',
        studentId: 'student-a',
        workspaceId: 'school-a',
        targetLevel: Level.city,
        status: ApplicationStatus.draft,
        currentDraftVersion: 1,
        submittedAt: null,
      },
    ),
  };
  prismaMock.$transaction.mockImplementation(async (callback) => callback(tx));
  return { service: new ApplicationsService(repository as never), repository, tx };
}

describe('Student City application creation contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('accepts a request without a target level and ignores stale client target-level values', () => {
    expect(startApplicationSchema.parse({})).toEqual({});
    expect(startApplicationSchema.parse({ targetLevel: 'school' })).toEqual({});
  });

  it('creates every new Student application as City and keeps the configured school-year default', async () => {
    const { service, tx } = buildService();

    await service.startCurrent(student, { targetLevel: Level.school } as never);

    expect(tx.application.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        studentId: student.id,
        workspaceId: student.workspaceId,
        schoolYear: normalizeSchoolYear(undefined),
        applicationType: ApplicationType.individual,
        targetLevel: Level.city,
      }),
    });
    expect(tx.applicationDraftSnapshot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        snapshotJson: expect.objectContaining({ targetLevel: Level.city }),
      }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        afterStateJson: expect.objectContaining({ targetLevel: Level.city }),
      }),
    });
  });

  it('returns an existing historical application without rewriting its target level', async () => {
    const historical = { id: 'application-a' };
    const { service, repository, tx } = buildService({ existing: historical });
    repository.findById.mockResolvedValue(
      responseApplication({ targetLevel: Level.school }) as never,
    );

    const result = await service.startCurrent(student, {});

    expect(result?.targetLevel).toBe(Level.school);
    expect(tx.application.create).not.toHaveBeenCalled();
    expect(tx.application.updateMany).not.toHaveBeenCalled();
  });

  it('rejects Student target-level PATCH before any write', async () => {
    const { service, tx } = buildService();

    await expect(
      service.updateTargetLevel(student, 'application-a', { targetLevel: Level.school }),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(tx.application.updateMany).not.toHaveBeenCalled();
    expect(tx.applicationDraftSnapshot.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects Student draft autosave carrying targetLevel before any write', async () => {
    const { service, tx } = buildService();

    await expect(
      service.autosaveDraft(student, 'application-a', { targetLevel: Level.school }),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(tx.application.updateMany).not.toHaveBeenCalled();
    expect(tx.applicationDraftSnapshot.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('continues to allow Student draft autosave when targetLevel is absent', async () => {
    const { service, tx } = buildService();

    await service.autosaveDraft(student, 'application-a', { notes: 'Draft note' });

    expect(tx.application.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'application-a' }),
      data: { currentDraftVersion: 2 },
    });
    expect(tx.applicationDraftSnapshot.create).toHaveBeenCalledOnce();
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
  });

  it('preserves the existing admin target-level compatibility path', async () => {
    const { service, tx } = buildService({
      bare: {
        id: 'application-a',
        studentId: 'student-a',
        workspaceId: 'school-a',
        targetLevel: Level.school,
        status: ApplicationStatus.draft,
        currentDraftVersion: 1,
        submittedAt: null,
      },
    });

    await service.updateTargetLevel(admin, 'application-a', { targetLevel: Level.city });

    expect(tx.application.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'application-a' }),
      data: expect.objectContaining({ targetLevel: Level.city }),
    });
  });
});

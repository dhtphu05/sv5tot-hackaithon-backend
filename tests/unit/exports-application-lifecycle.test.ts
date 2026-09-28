import { Role } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  application: { findMany: vi.fn() },
  reviewTask: { findMany: vi.fn() },
  auditLog: { create: vi.fn() },
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({ prisma: prismaMock }));

import { ExportsService } from '../../src/modules/exports/exports.service';
import {
  exportApplicationsQuerySchema,
  exportReviewResultsSchema,
  exportReviewTasksQuerySchema,
} from '../../src/modules/exports/exports.validation';
import type { AuthenticatedUser } from '../../src/shared/types/auth';

const manager: AuthenticatedUser = {
  id: 'manager-1',
  role: Role.manager,
  workspaceId: 'school-1',
  email: 'manager@example.test',
  fullName: 'School Manager',
  studentCode: null,
  className: null,
  faculty: null,
  avatarUrl: null,
  workspace: { id: 'school-1', code: 'SCHOOL', name: 'School', shortName: null },
};

describe('application lifecycle export scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.application.findMany.mockResolvedValue([]);
    prismaMock.reviewTask.findMany.mockResolvedValue([]);
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });
  });

  it('keeps official result exports current and includes archived applications', async () => {
    await new ExportsService().exportReviewResults(manager, { format: 'json' });

    expect(prismaMock.application.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ cancelledAt: null }),
      }),
    );
    expect(prismaMock.application.findMany.mock.calls[0][0].where).not.toHaveProperty('archivedAt');
  });

  it('does not export superseded final details after the current final was reopened', async () => {
    const oldFinalizedAt = new Date('2026-09-20T10:00:00.000Z');
    prismaMock.application.findMany.mockResolvedValue([
      {
        student: {
          studentCode: '00123',
          fullName: 'Student Example',
          className: 'Class 1',
          faculty: 'Faculty',
        },
        schoolYear: '2025-2026',
        targetLevel: 'city',
        finalLevel: null,
        finalStatus: 'pending',
        status: 'under_review',
        readinessScore: 70,
        submittedAt: new Date('2026-09-01T10:00:00.000Z'),
        finalizedAt: null,
        finalizedBy: null,
        finalNote: null,
        reviewTasks: [],
        cascadeReviews: [],
        auditLogs: [
          { action: 'APPLICATION_FINALIZED', createdAt: oldFinalizedAt, note: null },
          {
            action: 'FINAL_RESULT_CONFIRMED',
            createdAt: oldFinalizedAt,
            note: 'Superseded final note',
          },
        ],
      },
    ] as never);

    const result = await new ExportsService().exportReviewResults(manager, { format: 'json' });

    expect(result).toMatchObject({
      data: [expect.objectContaining({ completedAt: null, finalNote: null })],
    });
  });

  it('defaults management application and task exports to active records', async () => {
    await new ExportsService().exportApplicationsJson(manager, {} as never);
    await new ExportsService().exportReviewTasksCsv(manager, {} as never);

    expect(prismaMock.application.findMany.mock.calls[0][0].where).toMatchObject({ cancelledAt: null });
    expect(prismaMock.reviewTask.findMany.mock.calls[0][0].where.application).toMatchObject({
      cancelledAt: null,
    });
  });

  it.each([
    ['active', null],
    ['cancelled', { not: null }],
  ] as const)('filters management exports for lifecycle=%s', async (lifecycle, cancelledAt) => {
    await new ExportsService().exportApplicationsJson(manager, { lifecycle } as never);
    await new ExportsService().exportReviewTasksCsv(manager, { lifecycle } as never);

    expect(prismaMock.application.findMany.mock.calls[0][0].where).toMatchObject({ cancelledAt });
    expect(prismaMock.reviewTask.findMany.mock.calls[0][0].where.application).toMatchObject({
      cancelledAt,
    });
  });

  it('includes both current and cancelled records when management lifecycle=all', async () => {
    await new ExportsService().exportApplicationsJson(manager, { lifecycle: 'all' } as never);
    await new ExportsService().exportReviewTasksCsv(manager, { lifecycle: 'all' } as never);

    expect(prismaMock.application.findMany.mock.calls[0][0].where).not.toHaveProperty('cancelledAt');
    expect(prismaMock.reviewTask.findMany.mock.calls[0][0].where.application).not.toHaveProperty('cancelledAt');
  });

  it('allows all lifecycle records only for management exports', () => {
    expect(exportApplicationsQuerySchema.parse({}).lifecycle).toBe('active');
    expect(exportApplicationsQuerySchema.parse({ lifecycle: 'cancelled' }).lifecycle).toBe('cancelled');
    expect(exportReviewTasksQuerySchema.parse({ lifecycle: 'all' }).lifecycle).toBe('all');
    expect(exportReviewResultsSchema.parse({ lifecycle: 'cancelled' })).not.toHaveProperty('lifecycle');
  });
});

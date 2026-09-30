import {
  ApplicationType,
  Criterion,
  EvidenceStatus,
  Level,
  ResolutionStatus,
  ReviewTaskStatus,
  Role,
  WorkspaceType,
} from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  reviewTask: { findMany: vi.fn() },
}));

const tx = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  reviewTask: {
    updateMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    findMany: vi.fn(),
  },
  evidence: { update: vi.fn(), updateMany: vi.fn() },
  application: { findUnique: vi.fn(), update: vi.fn() },
  resolutionCase: { findFirst: vi.fn(), create: vi.fn() },
  notification: { create: vi.fn() },
  user: { findMany: vi.fn() },
  auditLog: { create: vi.fn() },
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({ prisma: prismaMock }));

import { ReviewService } from '../../src/modules/review/review.service';

const cityOfficer = {
  id: 'city-officer',
  role: Role.city_officer,
  workspaceId: 'city-workspace',
  workspace: {
    id: 'city-workspace',
    code: 'DANANG_CITY',
    name: 'Da Nang',
    shortName: 'Da Nang',
    type: WorkspaceType.CITY,
    isActive: true,
  },
};

function buildTask() {
  return {
    id: 'task-academic',
    workspaceId: 'school-workspace',
    workspace: { type: WorkspaceType.SCHOOL, isActive: true },
    applicationId: 'application-a',
    collectiveProfileId: null,
    criterion: Criterion.academic,
    status: ReviewTaskStatus.reviewing,
    decision: null,
    officerNote: null,
    assignedOfficerId: cityOfficer.id,
    updatedAt: new Date('2026-09-30T00:00:00.000Z'),
    evidences: [
      {
        evidenceId: 'evidence-academic',
        evidence: { id: 'evidence-academic', status: EvidenceStatus.under_review },
      },
    ],
    application: {
      id: 'application-a',
      applicationType: ApplicationType.individual,
      targetLevel: Level.city,
      status: 'under_review',
      student: {
        id: 'student-a',
        fullName: 'Student A',
        email: 'student@example.test',
        faculty: 'Faculty A',
      },
    },
    collectiveProfile: null,
    assignedOfficer: null,
  };
}

describe('City Officer S5 Resolution handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const task = buildTask();
    prismaMock.reviewTask.findMany.mockResolvedValue([
      { status: ReviewTaskStatus.resolution_needed },
    ]);
    prismaMock.$transaction.mockImplementation(async (callback: (value: unknown) => unknown) =>
      callback(tx),
    );
    tx.$queryRaw.mockResolvedValue([{ id: 'application-a', cancelledAt: null }]);
    tx.reviewTask.updateMany.mockResolvedValue({ count: 1 });
    tx.reviewTask.findUniqueOrThrow.mockResolvedValue({ ...task, status: ReviewTaskStatus.resolution_needed });
    tx.reviewTask.findMany.mockResolvedValue([
      { status: ReviewTaskStatus.resolution_needed, officerSuggestedLevel: null },
    ]);
    tx.evidence.updateMany.mockResolvedValue({ count: 1 });
    tx.evidence.update.mockResolvedValue({});
    tx.application.findUnique.mockResolvedValue({ workspaceId: 'school-workspace' });
    tx.application.update.mockResolvedValue({
      status: 'resolution_needed',
      finalStatus: 'pending',
      finalLevel: null,
    });
    tx.resolutionCase.findFirst.mockResolvedValue(null);
    tx.resolutionCase.create.mockResolvedValue({ id: 'resolution-case-a' });
    tx.notification.create.mockResolvedValue({
      id: 'notification-a',
      userId: 'student-a',
      applicationId: 'application-a',
      collectiveProfileId: null,
      evidenceId: 'evidence-academic',
      reviewTaskId: 'task-academic',
      resolutionCaseId: 'resolution-case-a',
      metadata: null,
      type: 'review_updated',
      title: 'Hồ sơ được chuyển hội đồng xem xét',
      message: 'Conflicting evidence needs committee review.',
      readAt: null,
      createdAt: new Date('2026-09-30T00:00:00.000Z'),
    });
    tx.user.findMany.mockResolvedValue([]);
    tx.auditLog.create.mockResolvedValue({ id: 'audit-a' });
  });

  it('returns the canonical ResolutionCase id and links the Officer evidence', async () => {
    const task = buildTask();
    const service = new ReviewService(
      { findDetail: vi.fn().mockResolvedValue(task) } as never,
      { canOfficerHandleCriterion: vi.fn().mockResolvedValue(true) } as never,
    );

    const result = await service.escalateResolution(cityOfficer as never, task.id, {
      reason: 'Conflicting evidence needs committee review.',
      evidenceIds: ['evidence-academic'],
    });

    expect(result).toMatchObject({
      task: { id: task.id, status: ReviewTaskStatus.resolution_needed },
      resolutionCaseId: 'resolution-case-a',
    });
    expect(tx.resolutionCase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        applicationId: 'application-a',
        workspaceId: 'school-workspace',
        evidenceId: 'evidence-academic',
        reviewTaskId: task.id,
        reason: 'Conflicting evidence needs committee review.',
        createdBy: cityOfficer.id,
        status: ResolutionStatus.open,
      }),
    });
  });
});

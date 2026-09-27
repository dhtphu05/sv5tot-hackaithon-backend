import {
  ApplicationStatus,
  Criterion,
  FinalStatus,
  Level,
  ReviewDecision,
  ReviewTaskStatus,
  Role,
  WorkspaceType,
} from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  auditLog: { findMany: vi.fn() },
  reviewTask: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({ prisma: prismaMock }));

import { prisma } from '../../src/infrastructure/database/prisma';
import { AuditService } from '../../src/modules/audit/audit.service';
import { ReviewService } from '../../src/modules/review/review.service';
import { auditActions } from '../../src/shared/constants/application';

const cityId = '22222222-2222-4222-8222-222222222222';
const schoolId = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.auditLog.findMany.mockResolvedValue([]);
  prismaMock.reviewTask.findMany.mockResolvedValue([]);
});

describe('City review audit visibility', () => {
  it.each([
    'RESOLUTION_CASE_OPENED',
    'RESOLUTION_CASE_RESOLVED',
    'RESOLUTION_DECISION_APPLIED',
    'RESOLUTION_STATUS_UPDATED',
    'KNOWLEDGE_BASE_ITEM_CREATED_FROM_RESOLUTION',
    auditActions.RESOLUTION_CASE_REOPENED,
  ])('includes the ResolutionService action %s in City audit searches', async (action) => {
    const service = new AuditService();
    await service.listLogs({ user: cityUser(Role.city_manager), action, limit: 10, offset: 0 });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ action: { in: [action] } }) }),
    );
  });

  it('continues excluding configuration and requirement-response actions from City audit searches', async () => {
    const service = new AuditService();
    for (const action of [auditActions.CRITERIA_VERSION_USED, auditActions.REQUIREMENT_RESPONSE_UPDATED]) {
      await service.listLogs({ user: cityUser(Role.city_manager), action, limit: 10, offset: 0 });
      expect(prisma.auditLog.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ action: { in: [] } }) }),
      );
    }
  });
});

describe('resolution escalation notification recipients', () => {
  it('scopes legacy staff to the application School, notifies active City staff and keeps admins global', async () => {
    const task = buildAssignedCityOfficerTask();
    const tx = {
      user: { findMany: vi.fn().mockResolvedValue([]) },
      reviewTask: {
        update: vi.fn().mockResolvedValue(task),
        findMany: vi.fn().mockResolvedValue([{ status: ReviewTaskStatus.resolution_needed }]),
      },
      evidence: { updateMany: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      application: {
        findUnique: vi.fn().mockResolvedValue({ workspaceId: schoolId }),
        update: vi.fn().mockResolvedValue({
          status: ApplicationStatus.resolution_needed,
          finalStatus: FinalStatus.pending,
          finalLevel: null,
        }),
      },
      resolutionCase: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'case-1' }),
      },
    };
    vi.mocked(prisma.$transaction).mockImplementation(
      ((callback: (transaction: unknown) => unknown) => callback(tx)) as never,
    );
    const notificationsService = { create: vi.fn().mockResolvedValue({ id: 'notification-1' }) };
    const service = new ReviewService(
      { findDetail: vi.fn().mockResolvedValue(task) } as never,
      { canOfficerHandleCriterion: vi.fn().mockResolvedValue(true) } as never,
      notificationsService as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.decideTask(cityUser(Role.city_officer), task.id, {
      decision: ReviewDecision.resolution_needed,
      officerNote: 'Please review this evidence again.',
      evidenceDecisions: [],
      evidenceAssessments: [],
    } as never);

    expect(tx.user.findMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        OR: [
          { role: { in: [Role.manager, Role.committee] }, workspaceId: schoolId },
          { role: Role.admin },
          {
            role: { in: [Role.city_manager, Role.city_committee] },
            workspace: { is: { type: WorkspaceType.CITY, isActive: true } },
          },
        ],
      },
      select: { id: true },
    });
    expect(notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: task.application.studentId,
        workspaceId: schoolId,
        applicationId: task.applicationId,
        type: expect.any(String),
      }),
      tx,
    );
  });
});

function cityUser(role: Role) {
  return {
    id: 'city-officer-1',
    email: 'reviewer@example.test',
    fullName: 'City Reviewer',
    role,
    studentCode: null,
    className: null,
    faculty: null,
    avatarUrl: null,
    workspaceId: cityId,
    workspace: {
      id: cityId,
      code: 'DANANG_CITY',
      type: WorkspaceType.CITY,
      name: 'Đà Nẵng',
      shortName: 'Đà Nẵng',
    },
  };
}

function buildAssignedCityOfficerTask() {
  return {
    id: 'task-1',
    workspaceId: schoolId,
    workspace: { type: WorkspaceType.SCHOOL, isActive: true },
    applicationId: 'application-1',
    collectiveProfileId: null,
    assignedOfficerId: 'city-officer-1',
    criterion: Criterion.volunteer,
    status: ReviewTaskStatus.waiting,
    decision: null,
    officerNote: null,
    officerSuggestedLevel: null,
    evidences: [{ evidenceId: 'evidence-1' }],
    evidenceIds: ['evidence-1'],
    evidenceNames: ['Volunteer evidence'],
    application: {
      id: 'application-1',
      workspaceId: schoolId,
      studentId: 'student-1',
      schoolYear: '2025-2026',
      targetLevel: Level.city,
      status: ApplicationStatus.under_review,
      finalStatus: FinalStatus.pending,
      finalLevel: null,
      student: {
        id: 'student-1',
        email: 'student@example.test',
        fullName: 'Student One',
        faculty: 'Engineering',
      },
    },
    collectiveProfile: null,
  };
}

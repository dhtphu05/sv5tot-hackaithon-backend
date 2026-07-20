import {
  ApplicationStatus,
  ApplicationType,
  Criterion,
  EvidenceSourceType,
  EvidenceStatus,
  IndexingStatus,
  Level,
  MetricType,
  ReviewTaskStatus,
  Role,
} from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../src/shared/types/auth';

const prismaMock = vi.hoisted(() => ({
  auditLog: { findMany: vi.fn() },
  eventRegistry: { findMany: vi.fn() },
  knowledgeBaseItem: { findMany: vi.fn() },
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({
  prisma: prismaMock,
}));

import { ReviewService } from '../../src/modules/review/review.service';

const now = new Date('2026-07-05T00:00:00.000Z');
const workspaceId = '11111111-1111-1111-1111-111111111111';

const managerUser: AuthenticatedUser = {
  id: 'manager-1',
  email: 'manager@5tot.test',
  fullName: 'Manager',
  role: Role.manager,
  studentCode: null,
  className: null,
  faculty: null,
  avatarUrl: null,
  workspaceId,
  workspace: null,
};

const assignedOfficerId = 'officer-assigned';

describe('ReviewService.getTaskDetail evidence event matching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.auditLog.findMany.mockResolvedValue([]);
    prismaMock.knowledgeBaseItem.findMany.mockResolvedValue([]);
  });

  it('returns matched event details when an evidence card has matchedEventId', async () => {
    prismaMock.eventRegistry.findMany.mockResolvedValue([
      {
        id: 'event-1',
        eventName: 'Olympic Tin học sinh viên',
        organizer: 'Hội Sinh viên Thành phố',
        organizerLevel: Level.city,
        startDate: new Date('2026-04-01T00:00:00.000Z'),
        endDate: new Date('2026-04-02T00:00:00.000Z'),
      },
    ]);
    const reviewRepository = {
      findDetail: vi.fn().mockResolvedValue(
        buildTask({
          matchedEventId: 'event-1',
          normalizedFieldsJson: {
            event_name: 'Olympic Tin học sinh viên',
            organizer: 'Hội Sinh viên Thành phố',
          },
        }),
      ),
    };
    const service = new ReviewService(reviewRepository as any, {} as any, {} as any);

    const detail = await service.getTaskDetail(managerUser, 'task-1');

    expect(prismaMock.eventRegistry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['event-1'] }, workspaceId },
      }),
    );
    expect(detail.evidences[0].event).toMatchObject({
      id: 'event-1',
      eventName: 'Olympic Tin học sinh viên',
      organizer: 'Hội Sinh viên Thành phố',
      organizerLevel: Level.city,
    });
    expect(detail.evidences[0].card?.matchingStatus).toMatchObject({
      code: 'official_match_found',
      matchedEventId: 'event-1',
      matchedEventName: 'Olympic Tin học sinh viên',
    });
    expect(detail.evidences[0].card?.readableSummary).toMatchObject({
      eventName: 'Olympic Tin học sinh viên',
      organizer: 'Hội Sinh viên Thành phố',
    });
  });

  it('keeps old-compatible response when evidence has no matched event', async () => {
    const reviewRepository = {
      findDetail: vi.fn().mockResolvedValue(buildTask({ matchedEventId: null })),
    };
    const service = new ReviewService(reviewRepository as any, {} as any, {} as any);

    const detail = await service.getTaskDetail(managerUser, 'task-1');

    expect(prismaMock.eventRegistry.findMany).not.toHaveBeenCalled();
    expect(detail.evidences[0].event).toBeNull();
    expect(detail.evidences[0].card?.matchingStatus).toMatchObject({
      code: 'official_match_not_found',
      matchedEventId: null,
    });
  });
});

describe('ReviewService demo officer permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows a demo officer with matching specialization to act on a task assigned to another officer', async () => {
    const reviewRepository = {
      list: vi.fn().mockResolvedValue({
        items: [
          buildTask({
            matchedEventId: null,
            assignedOfficerId,
            criterion: Criterion.ethics,
          }),
        ],
        total: 1,
      }),
    };
    const assignmentService = {
      canOfficerHandleCriterion: vi.fn().mockResolvedValue(true),
    };
    const service = new ReviewService(reviewRepository as any, assignmentService as any);

    const result = await service.listTasks(buildOfficerUser('officer.ethics@dut.udn.vn'), {
      page: 1,
      limit: 10,
    } as any);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].permissions).toMatchObject({
      canView: true,
      canAct: true,
      canClaim: false,
      reason: 'demo_specialization_access',
    });
  });

  it('keeps normal officers read-only when a matching task is assigned to another officer', async () => {
    const reviewRepository = {
      list: vi.fn().mockResolvedValue({
        items: [
          buildTask({
            matchedEventId: null,
            assignedOfficerId,
            criterion: Criterion.ethics,
          }),
        ],
        total: 1,
      }),
    };
    const assignmentService = {
      canOfficerHandleCriterion: vi.fn().mockResolvedValue(true),
    };
    const service = new ReviewService(reviewRepository as any, assignmentService as any);

    const result = await service.listTasks(buildOfficerUser('real.officer@dut.udn.vn'), {
      page: 1,
      limit: 10,
    } as any);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].permissions).toMatchObject({
      canView: true,
      canAct: false,
      canClaim: false,
      reason: 'assigned_to_other',
    });
  });
});

function buildTask(input: {
  matchedEventId: string | null;
  normalizedFieldsJson?: Record<string, unknown>;
  assignedOfficerId?: string | null;
  criterion?: Criterion;
}) {
  return {
    id: 'task-1',
    workspaceId,
    applicationId: 'app-1',
    collectiveProfileId: null,
    assignedOfficerId: input.assignedOfficerId ?? null,
    criterion: input.criterion ?? Criterion.academic,
    status: ReviewTaskStatus.reviewing,
    decision: null,
    officerNote: null,
    officerSuggestedLevel: null,
    levelAssessmentJson: null,
    decisionReason: null,
    supplementRequestJson: null,
    dueDate: null,
    createdAt: now,
    updatedAt: now,
    assignedOfficer: null,
    collectiveProfile: null,
    _count: { evidences: 1 },
    application: {
      id: 'app-1',
      workspaceId,
      schoolYear: '2025-2026',
      targetLevel: Level.city,
      applicationType: ApplicationType.individual,
      status: ApplicationStatus.under_review,
      student: {
        id: 'student-1',
        fullName: 'Nguyễn Văn A',
        studentCode: '102220001',
        className: '22T1',
        faculty: 'CNTT',
        email: 'student@5tot.test',
      },
      metrics: [
        {
          id: 'metric-1',
          applicationId: 'app-1',
          metricType: MetricType.gpa,
          value: 3.2,
          note: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
      precheckResults: [],
      cascadeReviews: [],
    },
    evidences: [
      {
        reviewTaskId: 'task-1',
        evidenceId: 'evidence-1',
        createdAt: now,
        evidence: {
          id: 'evidence-1',
          applicationId: 'app-1',
          evidenceName: 'Bảng điểm học tập',
          criterion: Criterion.academic,
          sourceType: EvidenceSourceType.manual_upload,
          status: EvidenceStatus.indexed,
          indexingStatus: IndexingStatus.indexed,
          confidence: 0.91,
          createdAt: now,
          updatedAt: now,
          evidenceFiles: [],
          event: null,
          evidenceCard: {
            id: 'card-1',
            ocrText: 'Bảng điểm học tập',
            extractedFieldsJson: {},
            normalizedFieldsJson: input.normalizedFieldsJson ?? {},
            warningsJson: [],
            matchedEventId: input.matchedEventId,
            matchedParticipantId: null,
            matchedKnowledgeItemIds: [],
            confidence: 0.92,
            aiSummary: 'SmartReader đã đọc được minh chứng.',
            createdAt: now,
            updatedAt: now,
          },
        },
      },
    ],
  } as any;
}

function buildOfficerUser(email: string): AuthenticatedUser {
  return {
    id: 'officer-current',
    email,
    fullName: 'Officer',
    role: Role.officer,
    studentCode: null,
    className: null,
    faculty: null,
    avatarUrl: null,
    workspaceId,
    workspace: null,
  };
}

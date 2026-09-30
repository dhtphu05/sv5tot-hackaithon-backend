import {
  ApplicationStatus,
  ApplicationType,
  Criterion,
  EvidenceSourceType,
  EvidenceStatus,
  IndexingStatus,
  Level,
  MetricType,
  ReviewDecision,
  ReviewTaskStatus,
  Role,
  WorkspaceType,
} from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../src/config/env';
import type { AuthenticatedUser } from '../../src/shared/types/auth';

const prismaMock = vi.hoisted(() => ({
  auditLog: { findMany: vi.fn() },
  eventRegistry: { findMany: vi.fn() },
  knowledgeBaseItem: { findMany: vi.fn() },
  criteriaVersion: { findFirst: vi.fn() },
  reviewTask: { updateMany: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({
  prisma: prismaMock,
}));

import { ReviewService } from '../../src/modules/review/review.service';

const now = new Date('2026-07-05T00:00:00.000Z');
const workspaceId = '11111111-1111-1111-1111-111111111111';

const assignedOfficerId = 'officer-assigned';

describe('ReviewService.getTaskDetail evidence event matching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.auditLog.findMany.mockResolvedValue([]);
    prismaMock.knowledgeBaseItem.findMany.mockResolvedValue([]);
    prismaMock.criteriaVersion.findFirst.mockImplementation(async ({ where }: any) => ({
      id: `criteria-${where.level}`,
      versionName: `Configured ${where.level}`,
      schoolYear: '2025-2026',
      unitScope: 'DHBK-DHDN',
      level: where.level,
      rules: [
        {
          criterion: Criterion.academic,
          ruleKey: `configured-academic-${where.level}`,
          ruleType: 'metric_threshold',
          thresholdJson: { metric: MetricType.gpa, operator: '>=', value: 3.9 },
          evidenceRequirementsJson: null,
          humanReadableText: `Configured GPA requirement for ${where.level}`,
        },
      ],
    }));
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

    const detail = await service.getTaskDetail(cityManagerUser(), 'task-1');

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

    const detail = await service.getTaskDetail(cityManagerUser(), 'task-1');

    expect(prismaMock.eventRegistry.findMany).not.toHaveBeenCalled();
    expect(detail.evidences[0].event).toBeNull();
    expect(detail.evidences[0].card?.matchingStatus).toMatchObject({
      code: 'official_match_not_found',
      matchedEventId: null,
    });
  });

  it('returns authoritative institution and review context in the existing detail response', async () => {
    const reviewRepository = {
      findDetail: vi.fn().mockResolvedValue(
        buildTask({ matchedEventId: null, dueDate: new Date('2026-10-15T00:00:00.000Z') }),
      ),
    };
    const service = new ReviewService(reviewRepository as any, {} as any, {} as any);

    const detail = await service.getTaskDetail(cityManagerUser(), 'task-1');

    expect(detail.task).toMatchObject({
      institutionName: 'Trường Đại học Bách khoa - Đại học Đà Nẵng',
      workspace: {
        id: workspaceId,
        name: 'Trường Đại học Bách khoa - Đại học Đà Nẵng',
        shortName: 'DHBK',
        type: WorkspaceType.SCHOOL,
      },
      dueDate: new Date('2026-10-15T00:00:00.000Z'),
    });
    expect(detail.application).toMatchObject({
      submittedAt: new Date('2026-09-01T00:00:00.000Z'),
      finalStatus: 'pending',
    });
  });

  it('uses the resolved CriteriaVersion rule for City reviewer assessment and exposes authority metadata', async () => {
    const service = new ReviewService(
      { findDetail: vi.fn().mockResolvedValue(buildTask({ matchedEventId: null })) } as any,
      {} as any,
    );

    const detail = await service.getTaskDetail(cityManagerUser(), 'task-1');
    const cityLevel = detail.criterionLevelAssessment?.levels.find(
      (level) => level.level === Level.city,
    );

    expect(cityLevel?.requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'configured-academic-city',
          label: 'Configured GPA requirement for city',
          requiredValue: '>= 3.9',
          source: 'criteria_version',
        }),
      ]),
    );
    expect(detail.criterionLevelAssessment).toMatchObject({
      criteriaAuthority: {
        source: 'CriteriaVersion',
        schoolYear: '2025-2026',
        targetLevel: Level.city,
      },
    });
  });

  it('keeps an unsupported configured rule human-review-only instead of inventing a pass or fail', async () => {
    prismaMock.criteriaVersion.findFirst.mockImplementation(async ({ where }: any) => ({
      id: `criteria-${where.level}`,
      versionName: `Configured ${where.level}`,
      schoolYear: '2025-2026',
      unitScope: 'DHBK-DHDN',
      level: where.level,
      rules: [
        {
          criterion: Criterion.academic,
          ruleKey: `manual-academic-${where.level}`,
          ruleType: 'unimplemented_rule_type',
          thresholdJson: { value: 999 },
          evidenceRequirementsJson: null,
          humanReadableText: 'Cán bộ phải đối chiếu theo quy định hiện hành.',
        },
      ],
    }));
    const service = new ReviewService(
      { findDetail: vi.fn().mockResolvedValue(buildTask({ matchedEventId: null })) } as any,
      {} as any,
    );

    const detail = await service.getTaskDetail(cityManagerUser(), 'task-1');
    const cityRequirement = detail.criterionLevelAssessment?.levels
      .find((level) => level.level === Level.city)
      ?.requirements.find((requirement) => requirement.key === 'manual-academic-city');

    expect(cityRequirement).toMatchObject({
      status: 'needs_review',
      source: 'criteria_version',
    });
    expect(cityRequirement?.requiredValue).toBeNull();
  });
});

describe('ReviewService demo officer permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    env.ENABLE_DEMO_REVIEW_BYPASS = false;
  });

  it('does not let a demo email bypass another officer assignment by default', async () => {
    const reviewRepository = {
      list: vi.fn().mockResolvedValue({
        items: [
          buildTask({
            matchedEventId: null,
            assignedOfficerId,
            criterion: Criterion.ethics,
            targetLevel: Level.school,
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
      canAct: false,
      canClaim: false,
      canRequestSupport: true,
      reason: 'assigned_to_other',
    });
  });

  it('preserves legacy demo access only when explicitly enabled', async () => {
    env.ENABLE_DEMO_REVIEW_BYPASS = true;
    const reviewRepository = {
      list: vi.fn().mockResolvedValue({
        items: [
          buildTask({
            matchedEventId: null,
            assignedOfficerId,
            criterion: Criterion.ethics,
            targetLevel: Level.school,
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
            targetLevel: Level.school,
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

describe('City Officer access to School review tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.auditLog.findMany.mockResolvedValue([]);
    prismaMock.knowledgeBaseItem.findMany.mockResolvedValue([]);
  });

  it('allows cross-school read for a matching specialization but keeps another assignment read-only', async () => {
    const task = buildTask({
      matchedEventId: null,
      assignedOfficerId: 'officer-school-b',
      criterion: Criterion.ethics,
    });
    const reviewRepository = { findDetail: vi.fn().mockResolvedValue(task) };
    const assignmentService = { canOfficerHandleCriterion: vi.fn().mockResolvedValue(true) };
    const service = new ReviewService(reviewRepository as any, assignmentService as any);

    const result = await service.getTaskDetail(cityOfficerUser(), 'task-1');

    expect(assignmentService.canOfficerHandleCriterion).toHaveBeenCalledWith(
      'city-officer',
      Criterion.ethics,
      'CNTT',
      undefined,
      Role.city_officer,
    );
    expect(result.task.permissions).toMatchObject({
      canView: true,
      canAct: false,
      canClaim: false,
      reason: 'assigned_to_other',
    });
  });

  it('denies detail access to an assigned task when City Officer specialization is no longer active', async () => {
    const task = buildTask({
      matchedEventId: null,
      assignedOfficerId: 'city-officer',
      criterion: Criterion.ethics,
    });
    const assignmentService = { canOfficerHandleCriterion: vi.fn().mockResolvedValue(false) };
    const service = new ReviewService(
      { findDetail: vi.fn().mockResolvedValue(task) } as any,
      assignmentService as any,
    );

    await expect(service.getTaskDetail(cityOfficerUser(), 'task-1')).rejects.toMatchObject({
      statusCode: 403,
    });

    expect(assignmentService.canOfficerHandleCriterion).toHaveBeenCalled();
  });

  it('does not let an unassigned City Officer claim a final School task', async () => {
    const task = buildTask({
      matchedEventId: null,
      criterion: Criterion.ethics,
      status: ReviewTaskStatus.accepted,
    });
    const service = new ReviewService(
      { findDetail: vi.fn().mockResolvedValue(task) } as any,
      { canOfficerHandleCriterion: vi.fn().mockResolvedValue(true) } as any,
    );

    const result = await service.getTaskDetail(cityOfficerUser(), 'task-1');

    expect(result.task.permissions).toMatchObject({
      canView: true,
      canAct: false,
      canClaim: false,
      reason: 'finalized',
    });
  });
});

describe('individual City review task permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.auditLog.findMany.mockResolvedValue([]);
    prismaMock.knowledgeBaseItem.findMany.mockResolvedValue([]);
  });

  it('lets City Managers view City tasks for coordination without criterion decision access', async () => {
    const service = new ReviewService(
      { findDetail: vi.fn().mockResolvedValue(buildTask({ matchedEventId: null })) } as never,
      {} as never,
    );

    const result = await service.getTaskDetail(cityManagerUser(), 'task-1');

    expect(result.task.permissions).toMatchObject({
      canView: true,
      canAct: false,
      canClaim: false,
    });
    await expect(
      service.decideTask(cityManagerUser(), 'task-1', {
        decision: 'accepted',
        officerSuggestedLevel: Level.city,
        evidenceDecisions: [],
        evidenceAssessments: [],
      } as never),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    await expect(service.claimTask(cityManagerUser(), 'task-1')).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(prismaMock.reviewTask.updateMany).not.toHaveBeenCalled();
  });

  it.each([Role.officer, Role.manager, Role.committee])(
    'denies legacy %s access to an individual City review task',
    async (role) => {
      const legacyUser = {
        ...cityManagerUser(),
        id: 'legacy-user',
        role,
        workspaceId,
        workspace: null,
      } as AuthenticatedUser;
      const service = new ReviewService(
        { findDetail: vi.fn().mockResolvedValue(buildTask({ matchedEventId: null })) } as never,
        { canOfficerHandleCriterion: vi.fn().mockResolvedValue(true) } as never,
      );

      await expect(service.getTaskDetail(legacyUser, 'task-1')).rejects.toMatchObject({
        statusCode: 403,
      });
    },
  );

  it('keeps City Committee read-only access to a City resolution task', async () => {
    const service = new ReviewService(
      {
        findDetail: vi
          .fn()
          .mockResolvedValue(
            buildTask({ matchedEventId: null, status: ReviewTaskStatus.resolution_needed }),
          ),
      } as never,
      {} as never,
    );

    const result = await service.getTaskDetail(cityCommitteeUser(), 'task-1');

    expect(result.task.permissions).toMatchObject({
      canView: true,
      canAct: false,
      canClaim: false,
    });
  });

  it('allows the assigned specialized City Officer to act on a claimable review task', async () => {
    const service = new ReviewService(
      {
        findDetail: vi
          .fn()
          .mockResolvedValue(
            buildTask({ matchedEventId: null, assignedOfficerId: 'city-officer' }),
          ),
      } as never,
      { canOfficerHandleCriterion: vi.fn().mockResolvedValue(true) } as never,
    );

    const result = await service.getTaskDetail(cityOfficerUser(), 'task-1');

    expect(result.task.permissions).toMatchObject({ canView: true, canAct: true, canClaim: false });
  });

  it('validates evidence assessment membership and notes before any decision write', async () => {
    const service = new ReviewService(
      {
        findDetail: vi.fn().mockResolvedValue(
          buildTask({ matchedEventId: null, assignedOfficerId: 'city-officer' }),
        ),
      } as never,
      { canOfficerHandleCriterion: vi.fn().mockResolvedValue(true) } as never,
    );

    await expect(
      service.decideTask(cityOfficerUser(), 'task-1', {
        decision: ReviewDecision.accepted,
        officerSuggestedLevel: Level.city,
        evidenceDecisions: [],
        evidenceAssessments: [
          {
            evidenceId: 'foreign-evidence',
            assessment: 'valid',
          },
        ],
      } as never),
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      service.decideTask(cityOfficerUser(), 'task-1', {
        decision: ReviewDecision.accepted,
        officerSuggestedLevel: Level.city,
        evidenceDecisions: [],
        evidenceAssessments: [
          {
            evidenceId: 'evidence-1',
            assessment: 'invalid',
            note: 'ok',
          },
        ],
      } as never),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('keeps a normal City Officer in waiting-for-student mode after requesting supplement', async () => {
    const service = new ReviewService(
      {
        findDetail: vi.fn().mockResolvedValue(
          buildTask({
            matchedEventId: null,
            assignedOfficerId: 'city-officer',
            status: ReviewTaskStatus.supplement_required,
          }),
        ),
      } as never,
      { canOfficerHandleCriterion: vi.fn().mockResolvedValue(true) } as never,
    );

    const result = await service.getTaskDetail(cityOfficerUser(), 'task-1');

    expect(result.task.permissions).toMatchObject({
      canView: true,
      canAct: false,
      canClaim: false,
      canRequestSupport: false,
      reason: 'supplement_pending',
      availableActions: ['view'],
    });
    await expect(
      service.decideTask(cityOfficerUser(), 'task-1', {
        decision: ReviewDecision.accepted,
        officerSuggestedLevel: Level.city,
        evidenceDecisions: [],
        evidenceAssessments: [],
      } as never),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('does not let a specialized City Officer claim a supplement-pending task', async () => {
    const service = new ReviewService(
      {
        findDetail: vi
          .fn()
          .mockResolvedValue(
            buildTask({ matchedEventId: null, status: ReviewTaskStatus.supplement_required }),
          ),
      } as never,
      { canOfficerHandleCriterion: vi.fn().mockResolvedValue(true) } as never,
    );

    await expect(service.claimTask(cityOfficerUser(), 'task-1')).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(prismaMock.reviewTask.updateMany).not.toHaveBeenCalled();
  });

  it.each([Role.student, Role.data_uploader])(
    'denies %s access to an individual City task',
    async (role) => {
      const user = {
        ...cityManagerUser(),
        id: 'non-review-user',
        role,
        workspaceId,
        workspace: null,
      } as AuthenticatedUser;
      const service = new ReviewService(
        { findDetail: vi.fn().mockResolvedValue(buildTask({ matchedEventId: null })) } as never,
        {} as never,
      );

      await expect(service.getTaskDetail(user, 'task-1')).rejects.toMatchObject({
        statusCode: 403,
      });
    },
  );

  it('preserves the existing global admin review bypass', async () => {
    const admin: AuthenticatedUser = {
      ...cityManagerUser(),
      id: 'admin',
      email: 'admin@5tot.test',
      role: Role.admin,
      workspaceId: null,
      workspace: null,
    };
    const service = new ReviewService(
      { findDetail: vi.fn().mockResolvedValue(buildTask({ matchedEventId: null })) } as never,
      {} as never,
    );

    const result = await service.getTaskDetail(admin, 'task-1');

    expect(result.task.permissions).toMatchObject({ canView: true, canAct: true });
  });

  it('uses updatedAt as a compare-and-swap token for admin overrides of final City tasks', async () => {
    const admin: AuthenticatedUser = {
      ...cityManagerUser(),
      id: 'admin',
      email: 'admin@5tot.test',
      role: Role.admin,
      workspaceId: null,
      workspace: null,
    };
    const task = {
      ...buildTask({ matchedEventId: null, status: ReviewTaskStatus.accepted }),
      decision: ReviewDecision.accepted,
    };
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    prismaMock.$transaction.mockImplementation((callback: (transaction: unknown) => unknown) =>
      callback({
        $queryRaw: vi.fn().mockResolvedValue([{ id: 'app-1', cancelledAt: null }]),
        reviewTask: { updateMany },
      }),
    );
    const service = new ReviewService(
      { findDetail: vi.fn().mockResolvedValue(task) } as never,
      {} as never,
    );

    await expect(
      service.decideTask(admin, 'task-1', {
        decision: ReviewDecision.rejected,
        officerNote: 'Admin correction after final review',
        evidenceDecisions: [],
        evidenceAssessments: [],
      } as never),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'task-1', updatedAt: now }),
        data: expect.objectContaining({ updatedAt: expect.any(Date) }),
      }),
    );
  });
});

function buildTask(input: {
  matchedEventId: string | null;
  normalizedFieldsJson?: Record<string, unknown>;
  assignedOfficerId?: string | null;
  criterion?: Criterion;
  status?: ReviewTaskStatus;
  targetLevel?: Level;
  dueDate?: Date | null;
}) {
  return {
    id: 'task-1',
    workspaceId,
    workspace: {
      id: workspaceId,
      name: 'Trường Đại học Bách khoa - Đại học Đà Nẵng',
      shortName: 'DHBK',
      type: 'SCHOOL',
      isActive: true,
    },
    applicationId: 'app-1',
    collectiveProfileId: null,
    assignedOfficerId: input.assignedOfficerId ?? null,
    criterion: input.criterion ?? Criterion.academic,
    status: input.status ?? ReviewTaskStatus.reviewing,
    decision: null,
    officerNote: null,
    officerSuggestedLevel: null,
    levelAssessmentJson: null,
    decisionReason: null,
    supplementRequestJson: null,
    dueDate: input.dueDate ?? null,
    createdAt: now,
    updatedAt: now,
    assignedOfficer: null,
    collectiveProfile: null,
    _count: { evidences: 1 },
    application: {
      id: 'app-1',
      workspaceId,
      schoolYear: '2025-2026',
      targetLevel: input.targetLevel ?? Level.city,
      applicationType: ApplicationType.individual,
      status: ApplicationStatus.under_review,
      submittedAt: new Date('2026-09-01T00:00:00.000Z'),
      finalStatus: 'pending',
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

function cityOfficerUser(): AuthenticatedUser {
  return {
    id: 'city-officer',
    email: 'officer@danang.city',
    fullName: 'City Officer',
    role: Role.city_officer,
    studentCode: null,
    className: null,
    faculty: null,
    avatarUrl: null,
    workspaceId: 'city-workspace',
    workspace: {
      id: 'city-workspace',
      code: 'DANANG_CITY',
      type: WorkspaceType.CITY,
      name: 'Da Nang',
      shortName: 'Da Nang',
    },
  };
}

function cityManagerUser(): AuthenticatedUser {
  return {
    id: 'city-manager',
    email: 'manager@danang.city',
    fullName: 'City Manager',
    role: Role.city_manager,
    studentCode: null,
    className: null,
    faculty: null,
    avatarUrl: null,
    workspaceId: 'city-workspace',
    workspace: {
      id: 'city-workspace',
      code: 'DANANG_CITY',
      type: WorkspaceType.CITY,
      name: 'Da Nang',
      shortName: 'Da Nang',
    },
  };
}

function cityCommitteeUser(): AuthenticatedUser {
  return { ...cityManagerUser(), id: 'city-committee', role: Role.city_committee };
}

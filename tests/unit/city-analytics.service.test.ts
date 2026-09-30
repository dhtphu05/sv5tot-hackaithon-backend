import {
  ApplicationStatus,
  ApplicationType,
  Criterion,
  FinalStatus,
  Level,
  ResolutionStatus,
  ReviewTaskStatus,
  Role,
  WorkspaceType,
} from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../src/shared/types/auth';

const prismaMock = vi.hoisted(() => ({
  application: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
  cityReviewSeason: { findFirst: vi.fn() },
  workspace: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({ prisma: prismaMock }));

import { CityAnalyticsService } from '../../src/modules/analytics/city-analytics.service';

const cityWorkspaceId = '00000000-0000-4000-8000-000000000001';
const schoolAId = '00000000-0000-4000-8000-000000000002';
const cityManager: AuthenticatedUser = {
  id: 'city-manager-id',
  email: 'manager@city.test',
  fullName: 'City Manager',
  role: Role.city_manager,
  studentCode: null,
  className: null,
  faculty: null,
  avatarUrl: null,
  workspaceId: cityWorkspaceId,
  workspace: {
    id: cityWorkspaceId,
    code: 'DANANG_CITY',
    name: 'Da Nang City',
    shortName: 'Da Nang',
    type: WorkspaceType.CITY,
  },
};
const admin: AuthenticatedUser = {
  ...cityManager,
  id: 'admin-id',
  role: Role.admin,
  workspaceId: null,
  workspace: null,
};

const criteria = [
  Criterion.ethics,
  Criterion.academic,
  Criterion.physical,
  Criterion.volunteer,
  Criterion.integration,
];

function makeApplication(input: {
  id: string;
  schoolId?: string;
  status: ApplicationStatus;
  submittedAt: Date | null;
  finalStatus?: FinalStatus;
  reviewTasks?: Array<{
    criterion: Criterion;
    status: ReviewTaskStatus;
    assignedOfficerId?: string | null;
  }>;
  resolutionCases?: Array<{ status: ResolutionStatus }>;
}) {
  return {
    id: input.id,
    workspaceId: input.schoolId ?? schoolAId,
    schoolYear: '2025-2026',
    applicationType: ApplicationType.individual,
    targetLevel: Level.city,
    status: input.status,
    submittedAt: input.submittedAt,
    finalStatus: input.finalStatus ?? FinalStatus.pending,
    workspace: {
      id: input.schoolId ?? schoolAId,
      code: input.schoolId === 'school-b' ? 'SCHOOL-B' : 'SCHOOL-A',
      name: input.schoolId === 'school-b' ? 'School B' : 'School A',
    },
    reviewTasks: input.reviewTasks ?? [],
    resolutionCases: input.resolutionCases ?? [],
  };
}

function fiveTasks(statuses: ReviewTaskStatus[], assignedOfficerId?: string) {
  return criteria.map((criterion, index) => ({
    criterion,
    status: statuses[index] ?? ReviewTaskStatus.waiting,
    assignedOfficerId: assignedOfficerId ?? null,
  }));
}

const submittedAt = new Date('2026-01-15T10:00:00.000Z');

describe('CityAnalyticsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.application.groupBy.mockResolvedValue([{ schoolYear: '2025-2026' }]);
    prismaMock.cityReviewSeason.findFirst.mockResolvedValue({ schoolYear: '2026-2027' });
    prismaMock.workspace.findMany.mockResolvedValue([
      { id: schoolAId, code: 'SCHOOL-A', name: 'School A' },
      { id: 'school-b', code: 'SCHOOL-B', name: 'School B' },
    ]);
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'city-officer-1', fullName: 'City Officer One' },
      { id: 'city-officer-2', fullName: 'City Officer Two' },
    ]);
    prismaMock.application.findMany.mockResolvedValue([]);
    prismaMock.application.count.mockResolvedValue(0);
  });

  it.each([
    Role.student,
    Role.city_officer,
    Role.city_committee,
    Role.data_uploader,
    Role.officer,
    Role.manager,
    Role.committee,
    Role.class_representative,
  ])('denies %s from summary and drill-down queries before database access', async (role) => {
    const user = { ...cityManager, role } as AuthenticatedUser;
    const service = new CityAnalyticsService();

    await expect(service.getSummary(user, {})).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.listApplications(user, { page: 1, limit: 20 })).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(prismaMock.application.findMany).not.toHaveBeenCalled();
  });

  it('requires a City workspace for City Managers', async () => {
    const invalidManager = {
      ...cityManager,
      workspace: { ...cityManager.workspace!, type: WorkspaceType.SCHOOL },
    };
    const service = new CityAnalyticsService();

    await expect(service.getSummary(invalidManager, {})).rejects.toMatchObject({ statusCode: 403 });
    expect(prismaMock.application.groupBy).not.toHaveBeenCalled();
  });

  it('allows admin to read the same City analytics surface', async () => {
    const service = new CityAnalyticsService();

    const summary = await service.getSummary(admin, {});

    expect(summary.filters.schoolYear).toBe('2026-2027');
    expect(prismaMock.application.findMany).toHaveBeenCalledTimes(1);
    const [applicationQuery] = prismaMock.application.findMany.mock.calls[0];
    expect(applicationQuery.where).toMatchObject({
      applicationType: ApplicationType.individual,
      targetLevel: Level.city,
      workspace: { is: { type: WorkspaceType.SCHOOL, isActive: true } },
    });
    expect(applicationQuery.where).not.toHaveProperty('workspaceId');
  });

  it('counts human City review state, separates final outcomes, and deduplicates application supplements', async () => {
    const officerId = 'city-officer-1';
    const rows = [
      makeApplication({
        id: 'draft',
        status: ApplicationStatus.draft,
        submittedAt: null,
      }),
      makeApplication({
        id: 'in-review',
        status: ApplicationStatus.under_review,
        submittedAt,
        reviewTasks: fiveTasks(
          [
            ReviewTaskStatus.accepted,
            ReviewTaskStatus.accepted,
            ReviewTaskStatus.accepted,
            ReviewTaskStatus.rejected,
            ReviewTaskStatus.waiting,
          ],
          officerId,
        ),
      }),
      makeApplication({
        id: 'review-complete',
        status: ApplicationStatus.under_review,
        submittedAt,
        reviewTasks: fiveTasks(Array(5).fill(ReviewTaskStatus.accepted), officerId),
      }),
      makeApplication({
        id: 'final-pass',
        status: ApplicationStatus.completed,
        submittedAt,
        finalStatus: FinalStatus.passed,
        reviewTasks: fiveTasks(Array(5).fill(ReviewTaskStatus.accepted), officerId),
      }),
      makeApplication({
        id: 'supplement',
        schoolId: 'school-b',
        status: ApplicationStatus.supplement_required,
        submittedAt,
        reviewTasks: [
          { criterion: Criterion.academic, status: ReviewTaskStatus.supplement_required, assignedOfficerId: officerId },
          { criterion: Criterion.ethics, status: ReviewTaskStatus.supplement_required, assignedOfficerId: officerId },
        ],
      }),
      makeApplication({
        id: 'resolution',
        schoolId: 'school-b',
        status: ApplicationStatus.resolution_needed,
        submittedAt,
        reviewTasks: [{ criterion: Criterion.ethics, status: ReviewTaskStatus.resolution_needed, assignedOfficerId: officerId }],
        resolutionCases: [{ status: ResolutionStatus.open }],
      }),
      makeApplication({
        id: 'final-fail',
        schoolId: 'school-b',
        status: ApplicationStatus.rejected,
        submittedAt,
        finalStatus: FinalStatus.failed,
        reviewTasks: fiveTasks(
          [ReviewTaskStatus.accepted, ReviewTaskStatus.accepted, ReviewTaskStatus.rejected, ReviewTaskStatus.rejected, ReviewTaskStatus.rejected],
          officerId,
        ),
      }),
    ];
    prismaMock.application.findMany.mockResolvedValue(rows as never);
    const service = new CityAnalyticsService();

    const summary = await service.getSummary(cityManager, {});

    expect(summary.applications).toMatchObject({
      created: 7,
      notSubmitted: 1,
      submitted: 6,
      supplementRequired: 1,
      resolutionBlocked: 1,
      reviewComplete: 3,
      progressDistribution: { '0': 2, '1': 0, '2': 0, '3': 0, '4': 1, '5': 3 },
      unexpectedTaskCount: 0,
      missingCriterionSlots: 7,
    });
    expect(summary.finalResults).toMatchObject({
      finalized: 2,
      passed: 1,
      failed: 1,
      partiallyPassed: 0,
      notFinalized: 4,
    });
    expect(summary.supplement).toEqual({ applications: 1, tasks: 2 });
    expect(summary.resolution).toMatchObject({ openCases: 1, resolvedCases: 0, blockedApplications: 1 });
    expect(summary.criteria.find((item) => item.criterion === Criterion.academic)).toMatchObject({
      totalTasks: 5,
      supplementRequired: 1,
      pass: 4,
      fail: 0,
    });
    expect(summary.reviewers.find((item) => item.officerId === officerId)).toMatchObject({
      assignedActive: 4,
      pending: 1,
      completed: 19,
      supplementRequired: 2,
      resolutionNeeded: 1,
    });
    expect(summary.bySchool).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ workspaceId: schoolAId, submitted: 3, reviewComplete: 2, finalPassed: 1 }),
        expect.objectContaining({ workspaceId: 'school-b', submitted: 3, supplementRequired: 1, finalFailed: 1 }),
      ]),
    );
    expect(JSON.stringify(summary)).not.toContain('studentCode');
    expect(JSON.stringify(summary)).not.toContain('studentName');
  });

  it('returns stable zero values for an empty selected school year', async () => {
    prismaMock.application.findMany.mockResolvedValue([]);
    prismaMock.application.groupBy.mockResolvedValue([]);
    prismaMock.workspace.findMany.mockResolvedValue([]);
    prismaMock.user.findMany.mockResolvedValue([]);
    const service = new CityAnalyticsService();

    const summary = await service.getSummary(cityManager, { schoolYear: '2099-2100' });

    expect(summary.applications).toMatchObject({
      created: 0,
      submitted: 0,
      notSubmitted: 0,
      reviewComplete: 0,
      progressDistribution: { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
      unexpectedTaskCount: 0,
    });
    expect(summary.finalResults).toMatchObject({ finalized: 0, passed: 0, failed: 0, notFinalized: 0 });
    expect(summary.criteria).toHaveLength(5);
    expect(summary.reviewers).toEqual([]);
    expect(summary.bySchool).toEqual([]);
  });

  it('returns a null selected year and zero metrics when no City applications exist', async () => {
    prismaMock.application.groupBy.mockResolvedValue([]);
    prismaMock.cityReviewSeason.findFirst.mockResolvedValue(null);
    prismaMock.workspace.findMany.mockResolvedValue([]);
    prismaMock.user.findMany.mockResolvedValue([]);
    const service = new CityAnalyticsService();

    const summary = await service.getSummary(cityManager, {});

    expect(summary.filters.schoolYear).toBeNull();
    expect(summary.availableSchoolYears).toEqual([]);
    expect(summary.applications.created).toBe(0);
    expect(summary.finalResults.notFinalized).toBe(0);
  });

  it('defaults summary and drill-down to the latest configured season when that season has no applications yet', async () => {
    prismaMock.application.groupBy.mockResolvedValue([{ schoolYear: '2025-2026' }]);
    prismaMock.application.findMany.mockResolvedValue([]);
    const service = new CityAnalyticsService();

    const summary = await service.getSummary(cityManager, {});
    const summaryQuery = prismaMock.application.findMany.mock.calls[0][0];

    await service.listApplications(cityManager, { page: 1, limit: 20 });
    const drillDownQuery = prismaMock.application.findMany.mock.calls[1][0];

    expect(summary.filters.schoolYear).toBe('2026-2027');
    expect(summary.availableSchoolYears).toEqual(['2026-2027', '2025-2026']);
    expect(summary.applications.created).toBe(0);
    expect(summaryQuery.where.schoolYear).toBe('2026-2027');
    expect(drillDownQuery.where.schoolYear).toBe('2026-2027');
  });

  it('reports missing criterion slots separately from duplicate or non-City task rows', async () => {
    prismaMock.application.findMany.mockResolvedValue([
      makeApplication({
        id: 'anomalous',
        status: ApplicationStatus.under_review,
        submittedAt,
        reviewTasks: [
          { criterion: Criterion.ethics, status: ReviewTaskStatus.accepted },
          { criterion: Criterion.ethics, status: ReviewTaskStatus.accepted },
          { criterion: Criterion.priority, status: ReviewTaskStatus.accepted },
        ],
      }),
    ] as never);
    const service = new CityAnalyticsService();

    const summary = await service.getSummary(cityManager, {});

    expect(summary.applications).toMatchObject({
      progressDistribution: { '0': 1 },
      unexpectedTaskCount: 2,
      missingCriterionSlots: 4,
      reviewComplete: 0,
    });
  });

  it('applies school year, school, and workflow status to all summary application queries', async () => {
    const service = new CityAnalyticsService();

    await service.getSummary(cityManager, {
      schoolYear: '2025-2026',
      workspaceId: schoolAId,
      status: ApplicationStatus.under_review,
    });

    const [query] = prismaMock.application.findMany.mock.calls[0];
    expect(query.where).toMatchObject({
      applicationType: ApplicationType.individual,
      targetLevel: Level.city,
      schoolYear: '2025-2026',
      workspaceId: schoolAId,
      status: ApplicationStatus.under_review,
      workspace: { is: { type: WorkspaceType.SCHOOL, isActive: true } },
    });
  });

  it('excludes cancelled applications from official metrics and reports their count separately', async () => {
    prismaMock.application.count.mockResolvedValue(2);
    prismaMock.application.findMany.mockResolvedValue([
      makeApplication({ id: 'active', status: ApplicationStatus.under_review, submittedAt }),
    ] as never);
    const service = new CityAnalyticsService();

    const summary = await service.getSummary(cityManager, { schoolYear: '2025-2026' });

    expect(summary.cancelledCount).toBe(2);
    expect(summary.applications.created).toBe(1);
    expect(prismaMock.application.findMany.mock.calls[0][0].where).toMatchObject({ cancelledAt: null });
    expect(prismaMock.application.findMany.mock.calls[0][0].where).not.toHaveProperty('archivedAt');
    expect(prismaMock.application.count.mock.calls[0][0].where).toMatchObject({
      cancelledAt: { not: null },
      schoolYear: '2025-2026',
    });
    expect(prismaMock.application.groupBy.mock.calls[0][0].where).not.toHaveProperty('cancelledAt');
  });

  it('paginates and scopes drill-down by the selected human criterion result', async () => {
    prismaMock.application.count.mockResolvedValue(21);
    const service = new CityAnalyticsService();

    const page = await service.listApplications(cityManager, {
      schoolYear: '2025-2026',
      workspaceId: schoolAId,
      criterion: Criterion.academic,
      taskStatus: ReviewTaskStatus.rejected,
      finalStatus: FinalStatus.failed,
      q: 'student-42',
      page: 2,
      limit: 10,
    });

    expect(page.pagination).toEqual({ page: 2, limit: 10, total: 21, totalPages: 3 });
    const listQuery = prismaMock.application.findMany.mock.calls[0][0];
    expect(listQuery).toMatchObject({ skip: 10, take: 10 });
    expect(listQuery.where).toMatchObject({
      cancelledAt: null,
      applicationType: ApplicationType.individual,
      targetLevel: Level.city,
      workspaceId: schoolAId,
      finalStatus: FinalStatus.failed,
      reviewTasks: { some: { criterion: Criterion.academic, status: ReviewTaskStatus.rejected } },
    });
  });

  it('drills down supplement and resolution application counts without changing workflow status semantics', async () => {
    const service = new CityAnalyticsService();

    await service.listApplications(cityManager, {
      status: ApplicationStatus.under_review,
      supplementRequired: true,
      resolutionBlocked: false,
      page: 1,
      limit: 20,
    });

    const query = prismaMock.application.findMany.mock.calls[0][0];
    expect(query.where).toMatchObject({
      status: ApplicationStatus.under_review,
      AND: [
        {
          OR: [
            { status: ApplicationStatus.supplement_required },
            { reviewTasks: { some: { status: ReviewTaskStatus.supplement_required } } },
          ],
        },
        {
          NOT: {
            OR: [
              { status: ApplicationStatus.resolution_needed },
              { reviewTasks: { some: { status: ReviewTaskStatus.resolution_needed } } },
              { resolutionCases: { some: { status: { in: [ResolutionStatus.open, ResolutionStatus.in_review] } } } },
            ],
          },
        },
      ],
    });
  });

  it('matches the in-review summary definition and submitted-only KPI in drill-down filters', async () => {
    const service = new CityAnalyticsService();

    await service.listApplications(cityManager, {
      inReview: true,
      submitted: true,
      page: 1,
      limit: 20,
    });

    const query = prismaMock.application.findMany.mock.calls[0][0];
    expect(query.where).toMatchObject({
      submittedAt: { not: null },
      AND: [
        {
          submittedAt: { not: null },
          status: { in: [ApplicationStatus.submitted, ApplicationStatus.under_review] },
        },
      ],
    });
  });

  it('can scope not-submitted applications independently from their final status', async () => {
    const service = new CityAnalyticsService();

    await service.listApplications(cityManager, {
      submitted: false,
      page: 1,
      limit: 20,
    });

    const query = prismaMock.application.findMany.mock.calls[0][0];
    expect(query.where).toMatchObject({ submittedAt: null });
  });
});

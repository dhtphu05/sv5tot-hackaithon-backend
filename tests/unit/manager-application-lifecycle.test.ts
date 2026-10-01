import {
  ApplicationStatus,
  ApplicationType,
  FinalStatus,
  Level,
  Role,
  WorkspaceType,
} from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../src/shared/types/auth';

const prismaMock = vi.hoisted(() => ({
  application: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
  auditLog: { findMany: vi.fn(), create: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({ prisma: prismaMock }));
vi.mock('../../src/modules/cascade/cascade.service', () => ({
  computeActiveCascadeSnapshot: vi.fn(),
}));

import { ManagerService } from '../../src/modules/manager/manager.service';
import {
  listManagerApplicationsQuerySchema,
  listManagerResultsQuerySchema,
} from '../../src/modules/manager/manager.validation';

const cityWorkspaceId = 'city-workspace';
const schoolAId = 'school-a';
const selectedSchoolId = '33333333-3333-4333-8333-333333333333';
const cityManager: AuthenticatedUser = {
  id: 'city-manager',
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
const cityCommittee: AuthenticatedUser = {
  ...cityManager,
  id: 'city-committee',
  role: Role.city_committee,
};
const admin: AuthenticatedUser = {
  ...cityManager,
  id: 'admin',
  role: Role.admin,
  workspaceId: null,
  workspace: null,
};

function resultDetail(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-09-28T00:00:00.000Z');
  return {
    id: 'application-1',
    workspaceId: schoolAId,
    workspace: { type: WorkspaceType.SCHOOL, isActive: true },
    studentId: 'student-1',
    schoolYear: '2025-2026',
    applicationType: 'individual',
    targetLevel: Level.city,
    status: ApplicationStatus.under_review,
    readinessScore: 60,
    submittedAt: now,
    finalStatus: FinalStatus.pending,
    finalLevel: null,
    finalNote: null,
    finalizedAt: null,
    finalizedById: null,
    finalizedBy: null,
    updatedAt: now,
    createdAt: now,
    student: {
      id: 'student-1',
      fullName: 'Student One',
      email: 'student@school.test',
      passwordHash: 'secret',
      phone: null,
      role: Role.student,
      studentCode: '00123',
      className: '26A',
      faculty: 'Engineering',
      avatarUrl: null,
      isActive: true,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    },
    metrics: [],
    requirementResponses: [],
    evidences: [],
    reviewTasks: [],
    resolutionCases: [],
    precheckResults: [],
    cascadeReviews: [],
    finalDecisionHistory: [],
    cancelledAt: null,
    cancelledById: null,
    cancelledBy: null,
    cancelReason: null,
    archivedAt: null,
    archivedById: null,
    archivedBy: null,
    archiveReason: null,
    ...overrides,
  };
}

describe('manager application lifecycle APIs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.application.findMany.mockResolvedValue([]);
    prismaMock.application.count.mockResolvedValue(0);
    prismaMock.application.findUnique.mockResolvedValue(null);
    prismaMock.auditLog.findMany.mockResolvedValue([]);
    prismaMock.auditLog.create.mockResolvedValue({});
    prismaMock.$transaction.mockResolvedValue([[], 0]);
  });

  it('defaults manager application and result lists to active, non-archived records', () => {
    expect(listManagerApplicationsQuerySchema.parse({})).toMatchObject({
      lifecycle: 'active',
      archive: 'exclude',
    });
    expect(listManagerResultsQuerySchema.parse({})).toMatchObject({
      lifecycle: 'active',
      archive: 'exclude',
    });
  });

  it('applies lifecycle, archive, workspace and existing filters together on the result list', async () => {
    const query = listManagerResultsQuerySchema.parse({
      workspaceId: selectedSchoolId,
      lifecycle: 'cancelled',
      archive: 'only',
      schoolYear: '2025-2026',
      status: ApplicationStatus.under_review,
      finalStatus: 'unfinalized',
      search: 'Student',
      page: '2',
    });
    const result = await new ManagerService().listResults(cityManager, query);

    expect(prismaMock.application.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.application.findMany.mock.calls[0][0].where).toMatchObject({
      workspace: { is: { type: WorkspaceType.SCHOOL, isActive: true } },
      AND: expect.arrayContaining([
        { workspaceId: selectedSchoolId },
        { status: ApplicationStatus.under_review },
        { schoolYear: '2025-2026' },
        { cancelledAt: { not: null } },
        { archivedAt: { not: null } },
        { OR: [{ finalStatus: FinalStatus.pending }, { finalizedAt: null }] },
      ]),
    });
    expect(result.pagination).toMatchObject({ page: 2, pageSize: 10 });
  });

  it('uses active and archive-excluded defaults on the applications list', async () => {
    const query = listManagerApplicationsQuerySchema.parse({ page: '1' });
    await new ManagerService().listApplications(cityManager, query);

    expect(prismaMock.application.findMany.mock.calls[0][0].where).toMatchObject({
      workspace: { is: { type: WorkspaceType.SCHOOL, isActive: true } },
      cancelledAt: null,
      archivedAt: null,
    });
  });

  it('keeps City Manager workspace filters inside active-school cross-school scope', async () => {
    const query = listManagerResultsQuerySchema.parse({ workspaceId: selectedSchoolId });
    await new ManagerService().listResults(cityManager, query);

    expect(prismaMock.application.findMany.mock.calls[0][0].where).toMatchObject({
      workspace: { is: { type: WorkspaceType.SCHOOL, isActive: true } },
      AND: expect.arrayContaining([{ workspaceId: selectedSchoolId }]),
    });
  });

  it.each([
    ['City Manager', cityManager],
    ['City Committee', cityCommittee],
    ['admin City results view', admin],
  ] as const)(
    '%s result list is restricted to active-school City individual applications',
    async (_label, user) => {
      const query = listManagerResultsQuerySchema.parse({ targetLevel: Level.school });
      await new ManagerService().listResults(user, query);

      expect(prismaMock.application.findMany.mock.calls[0][0].where).toMatchObject({
        applicationType: ApplicationType.individual,
        targetLevel: Level.city,
        schoolYear: '2025-2026',
        workspace: { is: { type: WorkspaceType.SCHOOL, isActive: true } },
        AND: expect.arrayContaining([{ targetLevel: Level.school }]),
      });
    },
  );

  it('defaults City application lists and Committee inbox to the 2025-2026 season', async () => {
    const query = listManagerApplicationsQuerySchema.parse({ page: '1' });
    await new ManagerService().listApplications(cityManager, query);
    expect(prismaMock.application.findMany.mock.calls[0][0].where).toMatchObject({
      applicationType: ApplicationType.individual,
      targetLevel: Level.city,
      schoolYear: '2025-2026',
    });

    prismaMock.application.findMany.mockClear();
    await new ManagerService().getCommitteeInbox(cityCommittee, {
      page: 1,
      limit: 20,
      bucket: 'all',
    } as never);
    expect(prismaMock.application.findMany.mock.calls[0][0].where).toMatchObject({
      applicationType: ApplicationType.individual,
      targetLevel: Level.city,
      schoolYear: '2025-2026',
    });
  });

  it('returns accurate City result summary counts across all matching rows, not just the current page', async () => {
    const now = new Date('2026-09-28T00:00:00.000Z');
    prismaMock.application.findMany
      .mockResolvedValueOnce([
        {
          id: 'passed-city',
          targetLevel: Level.city,
          finalLevel: Level.city,
          finalStatus: FinalStatus.passed,
          finalizedAt: now,
          readinessScore: 100,
          updatedAt: now,
          submittedAt: now,
          createdAt: now,
          reviewTasks: [],
          resolutionCases: [],
          cascadeReviews: [],
        },
        {
          id: 'partial',
          targetLevel: Level.city,
          finalLevel: null,
          finalStatus: FinalStatus.partially_passed,
          finalizedAt: now,
          readinessScore: 80,
          updatedAt: now,
          submittedAt: now,
          createdAt: now,
          reviewTasks: [],
          resolutionCases: [],
          cascadeReviews: [],
        },
        {
          id: 'city-result-partial-level',
          targetLevel: Level.city,
          finalLevel: Level.school,
          finalStatus: FinalStatus.passed,
          finalizedAt: now,
          readinessScore: 80,
          updatedAt: now,
          submittedAt: now,
          createdAt: now,
          reviewTasks: [],
          resolutionCases: [],
          cascadeReviews: [],
        },
        {
          id: 'failed',
          targetLevel: Level.city,
          finalLevel: null,
          finalStatus: FinalStatus.failed,
          finalizedAt: now,
          readinessScore: 40,
          updatedAt: now,
          submittedAt: now,
          createdAt: now,
          reviewTasks: [],
          resolutionCases: [],
          cascadeReviews: [],
        },
        {
          id: 'pending',
          targetLevel: Level.city,
          finalLevel: null,
          finalStatus: FinalStatus.pending,
          finalizedAt: null,
          readinessScore: 60,
          updatedAt: now,
          submittedAt: now,
          createdAt: now,
          reviewTasks: [],
          resolutionCases: [],
          cascadeReviews: [],
        },
      ] as never)
      .mockResolvedValueOnce([]);

    const result = await new ManagerService().listResults(
      cityManager,
      listManagerResultsQuerySchema.parse({ pageSize: 1 }),
    );

    expect(result.pagination.total).toBe(5);
    expect(result.items).toHaveLength(0);
    expect(result.summary).toEqual({
      totalApplications: 5,
      passedCity: 1,
      notAchievedCity: 3,
      unfinalized: 1,
    });
  });

  it('filters the City non-achieved bucket without exposing cascade levels', async () => {
    prismaMock.application.findMany.mockResolvedValueOnce([] as never).mockResolvedValueOnce([] as never);

    await new ManagerService().listResults(
      cityManager,
      listManagerResultsQuerySchema.parse({ finalStatus: FinalStatus.failed }),
    );

    const [query] = prismaMock.application.findMany.mock.calls[0];
    expect(query.where).toMatchObject({
      AND: expect.arrayContaining([
        {
          OR: [
            { finalStatus: FinalStatus.failed },
            { finalStatus: FinalStatus.partially_passed },
            {
              AND: [
                { finalStatus: FinalStatus.passed },
                { OR: [{ finalLevel: { not: Level.city } }, { finalLevel: null }] },
              ],
            },
          ],
        },
      ]),
    });
  });

  it.each([cityManager, cityCommittee, admin])(
    'does not expose non-City applications through the City result detail route for %s',
    async (user) => {
      prismaMock.application.findUnique.mockResolvedValueOnce(
        resultDetail({ targetLevel: Level.school }) as never,
      );

      await expect(
        new ManagerService().getResultDetail(user, 'application-1'),
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    },
  );

  it('allows explicit all lifecycle and archive filters without dropping existing constraints', async () => {
    await new ManagerService().listResults(
      cityManager,
      listManagerResultsQuerySchema.parse({
        lifecycle: 'all',
        archive: 'all',
        schoolYear: '2025-2026',
      }),
    );

    expect(prismaMock.application.findMany.mock.calls[0][0].where).toMatchObject({
      workspace: { is: { type: WorkspaceType.SCHOOL, isActive: true } },
      AND: [{ schoolYear: '2025-2026' }],
    });
    expect(prismaMock.application.findMany.mock.calls[0][0].where).not.toHaveProperty(
      'cancelledAt',
    );
    expect(prismaMock.application.findMany.mock.calls[0][0].where).not.toHaveProperty('archivedAt');
  });

  it('keeps archived non-cancelled current finals in explicit result views', async () => {
    const now = new Date('2026-09-28T00:00:00.000Z');
    const candidate = {
      id: 'application-1',
      targetLevel: Level.city,
      finalStatus: FinalStatus.passed,
      readinessScore: 100,
      finalizedAt: now,
      updatedAt: now,
      submittedAt: now,
      createdAt: now,
      reviewTasks: [],
      resolutionCases: [],
      cascadeReviews: [{ suggestedLevel: Level.city }],
    };
    prismaMock.application.findMany.mockResolvedValueOnce([candidate]).mockResolvedValueOnce([
      resultDetail({
        finalStatus: FinalStatus.passed,
        finalLevel: Level.city,
        finalizedAt: now,
        archivedAt: now,
        archiveReason: 'Season closed',
      }),
    ]);

    const result = await new ManagerService().listResults(
      cityManager,
      listManagerResultsQuerySchema.parse({
        lifecycle: 'active',
        archive: 'only',
        finalStatus: FinalStatus.passed,
      }),
    );

    expect(prismaMock.application.findMany.mock.calls[0][0].where).toMatchObject({
      AND: expect.arrayContaining([
        { cancelledAt: null },
        { archivedAt: { not: null } },
        { finalStatus: FinalStatus.passed, finalLevel: Level.city },
      ]),
    });
    expect(result.items[0]).toMatchObject({
      finalStatus: FinalStatus.passed,
      archivedAt: now.toISOString(),
      archiveReason: 'Season closed',
    });
  });

  it('returns lifecycle metadata and ordered final history in cross-school City detail', async () => {
    const now = new Date('2026-09-28T00:00:00.000Z');
    const history = {
      id: 'history-1',
      finalStatus: FinalStatus.passed,
      finalLevel: Level.city,
      finalNote: 'Prior decision',
      finalizedAt: now,
      finalizedById: 'reviewer-1',
      finalizedBy: { id: 'reviewer-1', fullName: 'Reviewer One' },
      supersededAt: now,
      supersededById: 'city-manager',
      supersededBy: { id: 'city-manager', fullName: 'City Manager' },
      supersedeReason: 'Cancelled for correction',
    };
    prismaMock.application.findUnique.mockResolvedValue(
      resultDetail({
        cancelledAt: now,
        cancelledById: cityManager.id,
        cancelledBy: { id: cityManager.id, fullName: cityManager.fullName },
        cancelReason: 'Duplicate application',
        archivedAt: now,
        archivedById: cityManager.id,
        archivedBy: { id: cityManager.id, fullName: cityManager.fullName },
        archiveReason: 'Season closed',
        finalDecisionHistory: [history],
      }),
    );

    const result = await new ManagerService().getResultDetail(cityManager, 'application-1');

    expect(result.application).toMatchObject({
      cancelledAt: now.toISOString(),
      cancelledBy: { id: cityManager.id, fullName: cityManager.fullName },
      cancelReason: 'Duplicate application',
      archivedAt: now.toISOString(),
      archivedBy: { id: cityManager.id, fullName: cityManager.fullName },
      archiveReason: 'Season closed',
    });
    expect(result.finalDecisionHistory).toEqual([
      expect.objectContaining({
        id: history.id,
        finalStatus: FinalStatus.passed,
        finalLevel: Level.city,
        finalizedBy: { id: 'reviewer-1', fullName: 'Reviewer One' },
        supersededBy: { id: cityManager.id, fullName: cityManager.fullName },
        supersedeReason: 'Cancelled for correction',
      }),
    ]);
    expect(
      prismaMock.application.findUnique.mock.calls[0][0].select.finalDecisionHistory,
    ).toMatchObject({
      orderBy: { supersededAt: 'desc' },
    });
  });

  it('projects manager result detail to serialized fields and reuses application evidence for task links', async () => {
    const createdAt = new Date('2026-09-28T00:00:00.000Z');
    const evidence = {
      id: 'evidence-1',
      evidenceName: 'Transcript',
      criterion: 'academic',
      sourceType: 'upload',
      status: 'pending',
      indexingStatus: 'completed',
      confidence: 0.9,
      evidenceFiles: [{
        evidenceId: 'evidence-1',
        fileId: 'file-1',
        file: { id: 'file-1', originalName: 'transcript.pdf', mimeType: 'application/pdf', fileSize: 123, createdAt },
      }],
      evidenceCard: {
        id: 'card-1',
        aiSummary: 'Transcript summary',
        confidence: 0.9,
        ocrText: 'OCR text',
        extractedFieldsJson: { gpa: 3.5 },
        warningsJson: null,
        matchedEventId: null,
        matchedKnowledgeItemIds: [],
      },
      event: { id: 'unused-event' },
    };
    prismaMock.application.findUnique.mockResolvedValueOnce(
      resultDetail({
        evidences: [evidence],
        reviewTasks: [{
          id: 'task-1',
          criterion: 'academic',
          status: 'accepted',
          decision: 'accepted',
          officerNote: 'Reviewed',
          officerSuggestedLevel: Level.city,
          levelAssessmentJson: null,
          decisionReason: 'Meets criterion',
          assignedOfficer: { id: 'officer-1', fullName: 'Officer One' },
          evidences: [{ evidenceId: 'evidence-1' }],
        }],
      }) as never,
    );

    const result = await new ManagerService().getResultDetail(cityManager, 'application-1');

    expect(result.applicationEvidences[0]).toMatchObject({
      id: 'evidence-1',
      files: [{ id: 'file-1', originalName: 'transcript.pdf' }],
      evidenceCard: { ocrText: 'OCR text' },
    });
    expect(result.reviewTasks[0]?.evidences).toEqual(result.applicationEvidences);

    const query = prismaMock.application.findUnique.mock.calls[0]?.[0] as {
      select: Record<string, unknown>;
    };
    expect(query.select.student).toMatchObject({ select: { id: true, fullName: true, studentCode: true } });
    expect(query.select.requirementResponses).toBeUndefined();
    expect(query.select.evidences).toMatchObject({
      select: {
        evidenceFiles: { select: { file: { select: { id: true, originalName: true, mimeType: true, fileSize: true, createdAt: true } } } },
        evidenceCard: { select: { id: true, aiSummary: true, confidence: true, ocrText: true, extractedFieldsJson: true, warningsJson: true, matchedEventId: true, matchedKnowledgeItemIds: true } },
      },
    });
    expect((query.select.evidences as { select: Record<string, unknown> }).select.event).toBeUndefined();
    expect(query.select.reviewTasks).toMatchObject({
      select: { evidences: { select: { evidenceId: true } } },
    });
    expect(prismaMock.application.findUnique).toHaveBeenCalledTimes(1);
  });

  it('reads the audit timeline and writes the view audit concurrently after scope authorization', async () => {
    let resolveTimeline!: (value: unknown[]) => void;
    prismaMock.application.findUnique.mockResolvedValueOnce(resultDetail() as never);
    prismaMock.auditLog.findMany.mockReturnValueOnce(
      new Promise((resolve) => { resolveTimeline = resolve; }) as never,
    );
    prismaMock.auditLog.create.mockResolvedValueOnce({ id: 'current-view' } as never);

    const pending = new ManagerService().getResultDetail(cityManager, 'application-1');
    await Promise.resolve();
    await Promise.resolve();

    expect(prismaMock.auditLog.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.auditLog.create.mock.calls[0]?.[0]).toMatchObject({
      data: { workspaceId: schoolAId },
    });

    resolveTimeline([
      { id: 'previous-view', actorId: cityManager.id, actorRole: cityManager.role, action: 'MANAGER_RESULT_DETAIL_VIEWED', targetType: 'application', targetId: 'application-1', note: null, createdAt: new Date('2026-09-27T00:00:00.000Z') },
      { id: 'current-view', actorId: cityManager.id, actorRole: cityManager.role, action: 'MANAGER_RESULT_DETAIL_VIEWED', targetType: 'application', targetId: 'application-1', note: null, createdAt: new Date('2026-09-28T00:00:00.000Z') },
    ]);
    const result = await pending;
    expect(result.auditTimeline.map((item) => item.id)).toEqual(['previous-view']);
  });

  it('keeps cross-school result detail hidden from legacy school managers', async () => {
    prismaMock.application.findUnique.mockResolvedValue(resultDetail());
    const legacyManager = {
      ...cityManager,
      role: Role.manager,
      workspaceId: 'school-b',
      workspace: {
        ...cityManager.workspace,
        id: 'school-b',
        type: WorkspaceType.SCHOOL,
      },
    } as AuthenticatedUser;

    await expect(
      new ManagerService().getResultDetail(legacyManager, 'application-1'),
    ).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});

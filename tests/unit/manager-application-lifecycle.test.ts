import { ApplicationStatus, FinalStatus, Level, Role, WorkspaceType } from '@prisma/client';
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

  it('allows explicit all lifecycle and archive filters without dropping existing constraints', async () => {
    await new ManagerService().listResults(
      cityManager,
      listManagerResultsQuerySchema.parse({ lifecycle: 'all', archive: 'all', schoolYear: '2025-2026' }),
    );

    expect(prismaMock.application.findMany.mock.calls[0][0].where).toMatchObject({
      workspace: { is: { type: WorkspaceType.SCHOOL, isActive: true } },
      AND: [{ schoolYear: '2025-2026' }],
    });
    expect(prismaMock.application.findMany.mock.calls[0][0].where).not.toHaveProperty('cancelledAt');
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
    prismaMock.application.findMany
      .mockResolvedValueOnce([candidate])
      .mockResolvedValueOnce([
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
        { finalStatus: FinalStatus.passed },
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
    expect(prismaMock.application.findUnique.mock.calls[0][0].include.finalDecisionHistory).toMatchObject({
      orderBy: { supersededAt: 'desc' },
    });
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

    await expect(new ManagerService().getResultDetail(legacyManager, 'application-1')).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});

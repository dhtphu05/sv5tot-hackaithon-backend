import {
  ApplicationEligibilityVerificationDecision,
  ApplicationType,
  Criterion,
  Level,
  ResolutionStatus,
  ReviewDecision,
  ReviewTaskStatus,
  Role,
  WorkspaceType,
} from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  application: { findUnique: vi.fn() },
  evidence: { findMany: vi.fn() },
  reviewTask: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
  user: { findUnique: vi.fn() },
  resolutionCase: { findUnique: vi.fn() },
  reviewTaskEvidence: { findMany: vi.fn() },
  officerSpecialization: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));
const tx = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  application: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  reviewTask: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  reviewTaskEvidence: { create: vi.fn() },
  auditLog: { create: vi.fn() },
  resolutionCase: { update: vi.fn(), findUnique: vi.fn() },
  notification: { create: vi.fn() },
  cascadeReview: { create: vi.fn() },
  user: { findUniqueOrThrow: vi.fn() },
  applicationEligibilityVerification: { upsert: vi.fn() },
  evidence: { update: vi.fn(), updateMany: vi.fn() },
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({ prisma: mocks }));
vi.mock('../../src/modules/cascade/cascade.service', () => ({
  computeActiveCascadeSnapshot: vi.fn().mockResolvedValue({
    targetLevel: Level.city,
    suggestedLevel: Level.city,
  }),
}));

import { ReviewService } from '../../src/modules/review/review.service';
import { ResolutionService } from '../../src/modules/resolution/resolution.service';
import { ManagerService } from '../../src/modules/manager/manager.service';
import { CitySubmissionEligibilityRepository } from '../../src/modules/applications/city-submission-eligibility.repository';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.application.findUnique.mockResolvedValue({
    id: 'application-1',
    workspaceId: 'school-1',
    applicationType: ApplicationType.individual,
    targetLevel: Level.city,
    status: 'under_review',
    student: { faculty: 'Faculty A' },
    workspace: { type: WorkspaceType.SCHOOL, isActive: true },
  });
  mocks.evidence.findMany.mockResolvedValue([]);
  mocks.reviewTask.findMany.mockResolvedValue([]);
  mocks.reviewTask.findUnique.mockResolvedValue(null);
  mocks.user.findUnique.mockResolvedValue(null);
  mocks.reviewTask.findFirst.mockResolvedValue(null);
  mocks.resolutionCase.findUnique.mockResolvedValue(null);
  mocks.reviewTaskEvidence.findMany.mockResolvedValue([]);
  mocks.officerSpecialization.findMany.mockResolvedValue([]);
  tx.$queryRaw.mockResolvedValue([{ id: 'application-1', cancelledAt: new Date() }]);
  tx.reviewTask.findMany.mockResolvedValue([]);
  tx.reviewTask.create.mockResolvedValue({ id: 'task-1' });
  tx.reviewTask.update.mockResolvedValue({ id: 'task-1' });
  tx.reviewTask.updateMany.mockResolvedValue({ count: 1 });
  tx.reviewTaskEvidence.create.mockResolvedValue({});
  tx.application.findUnique.mockResolvedValue({ workspaceId: 'school-1' });
  tx.application.update.mockResolvedValue({});
  tx.application.findUnique.mockResolvedValue({
    id: 'application-1',
    workspaceId: 'school-1',
    workspace: { type: WorkspaceType.SCHOOL, isActive: true },
    applicationType: ApplicationType.individual,
    targetLevel: Level.city,
    status: 'under_review',
    finalStatus: 'pending',
    finalLevel: null,
    finalizedAt: null,
    readinessScore: 0,
    reviewTasks: [],
    resolutionCases: [],
    cascadeReviews: [],
    precheckResults: [],
    student: { id: 'student-1', fullName: 'Student', studentCode: '1001', className: 'C1', faculty: 'Faculty A' },
  });
  tx.application.findUniqueOrThrow.mockResolvedValue({});
  tx.application.updateMany.mockResolvedValue({ count: 1 });
  tx.auditLog.create.mockResolvedValue({ id: 'audit-1' });
  tx.resolutionCase.update.mockResolvedValue({});
  tx.resolutionCase.findUnique.mockResolvedValue({});
  tx.notification.create.mockResolvedValue({ id: 'notification-1' });
  tx.evidence.update.mockResolvedValue({});
  tx.evidence.updateMany.mockResolvedValue({ count: 0 });
  tx.cascadeReview.create.mockResolvedValue({ id: 'cascade-1' });
  tx.user.findUniqueOrThrow.mockResolvedValue({ id: 'student-1' });
  tx.applicationEligibilityVerification.upsert.mockResolvedValue({ id: 'verification-1' });
  mocks.$transaction.mockImplementation(async (callback: (value: unknown) => unknown) =>
    callback(tx),
  );
});

describe('cancelled City adjudication writes', () => {
  const cityOfficer = {
    id: 'city-officer-1',
    role: Role.city_officer,
    workspaceId: 'city-workspace',
    workspace: {
      id: 'city-workspace',
      code: 'DANANG_CITY',
      name: 'Da Nang',
      shortName: 'Da Nang',
      type: WorkspaceType.CITY,
    },
  };
  const reviewTask = (assignedOfficerId: string | null, status: ReviewTaskStatus) => ({
    id: 'task-1',
    workspaceId: 'school-1',
    workspace: { type: WorkspaceType.SCHOOL, isActive: true },
    applicationId: 'application-1',
    collectiveProfileId: null,
    criterion: Criterion.academic,
    status,
    decision: null,
    assignedOfficerId,
    updatedAt: new Date('2026-09-26T00:00:00.000Z'),
    evidences: [],
    application: {
      applicationType: ApplicationType.individual,
      targetLevel: Level.city,
      student: { id: 'student-1', faculty: 'Faculty A', email: 'student@example.test', fullName: 'Student' },
      workspace: { type: WorkspaceType.SCHOOL, isActive: true },
      status: 'under_review',
      finalStatus: 'pending',
      finalLevel: null,
    },
    collectiveProfile: null,
  });
  const resolutionCase = (status: ResolutionStatus) => ({
    id: 'case-1',
    workspaceId: 'school-1',
    workspace: { type: WorkspaceType.SCHOOL, isActive: true },
    applicationId: 'application-1',
    evidenceId: null,
    reviewTaskId: null,
    reason: 'Review requested',
    status,
    committeeDecision: null,
    createdBy: 'student-1',
    closedBy: null,
    createdAt: new Date(),
    closedAt: null,
    application: {
      id: 'application-1',
      workspaceId: 'school-1',
      applicationType: ApplicationType.individual,
      targetLevel: Level.city,
      status: 'resolution_needed',
      student: { id: 'student-1', fullName: 'Student', studentCode: '1001', className: 'C1', faculty: 'Faculty A' },
    },
    evidence: null,
    reviewTask: null,
  });
  const cityManager = {
    id: 'city-manager',
    role: Role.city_manager,
    workspaceId: 'city-workspace',
    workspace: {
      id: 'city-workspace',
      code: 'DANANG_CITY',
      name: 'Da Nang',
      shortName: 'Da Nang',
      type: WorkspaceType.CITY,
    },
  };
  const cityApplication = () => ({
    id: 'application-1',
    workspaceId: 'school-1',
    workspace: { type: WorkspaceType.SCHOOL, isActive: true },
    applicationType: ApplicationType.individual,
    targetLevel: Level.city,
    status: 'under_review',
    finalStatus: 'pending',
    finalLevel: null,
    finalNote: null,
    finalizedAt: null,
    finalizedById: null,
    cancelledAt: null,
    studentId: 'student-1',
    schoolYear: '2026-2027',
    readinessScore: 0,
    reviewTasks: [],
    resolutionCases: [],
    cascadeReviews: [],
    precheckResults: [],
    metrics: [],
    evidences: [],
    requirementResponses: [],
    student: { id: 'student-1', fullName: 'Student', studentCode: '1001', className: 'C1', faculty: 'Faculty A' },
  });

  it('stops task ensuring before task, application, or audit writes', async () => {
    await expect(
      new ReviewService().ensureReviewTasks(
        { id: 'admin-1', role: Role.admin } as never,
        'application-1',
        {},
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'APPLICATION_CANCELLED',
      message: 'Hồ sơ đã bị hủy. Mở lại hồ sơ trước khi tiếp tục xử lý.',
    });

    expect(tx.reviewTask.create).not.toHaveBeenCalled();
    expect(tx.reviewTaskEvidence.create).not.toHaveBeenCalled();
    expect(tx.application.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it.each([
    ['claimTask', () => reviewTask(null, ReviewTaskStatus.waiting), 'claimTask'],
    ['decideTask', () => reviewTask('city-officer-1', ReviewTaskStatus.reviewing), 'decideTask'],
    ['requestSupplement', () => reviewTask('city-officer-1', ReviewTaskStatus.reviewing), 'requestSupplement'],
    ['escalateResolution', () => reviewTask('city-officer-1', ReviewTaskStatus.reviewing), 'escalateResolution'],
  ] as const)('stops %s before review writes', async (_name, getTask, method) => {
    const task = getTask();
    const service = new ReviewService(
      { findDetail: vi.fn().mockResolvedValue(task) } as never,
      { canOfficerHandleCriterion: vi.fn().mockResolvedValue(true) } as never,
    );
    const operation =
      method === 'claimTask'
        ? service.claimTask(cityOfficer as never, 'task-1')
        : method === 'decideTask'
          ? service.decideTask(cityOfficer as never, 'task-1', {
              decision: ReviewDecision.rejected,
              officerNote: 'Evidence does not meet the requirement.',
              evidenceDecisions: [],
              evidenceAssessments: [],
            })
          : method === 'requestSupplement'
            ? service.requestSupplement(cityOfficer as never, 'task-1', {
                reason: 'Please provide the required certificate.',
              })
            : service.escalateResolution(cityOfficer as never, 'task-1', {
                reason: 'Conflicting evidence needs committee review.',
              });

    await expect(operation).rejects.toMatchObject({
      statusCode: 409,
      code: 'APPLICATION_CANCELLED',
    });
    expect(tx.reviewTask.update).not.toHaveBeenCalled();
    expect(tx.reviewTask.updateMany).not.toHaveBeenCalled();
    expect(tx.reviewTask.create).not.toHaveBeenCalled();
    expect(tx.reviewTaskEvidence.create).not.toHaveBeenCalled();
    expect(tx.application.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('stops manual eligibility verification before changing its record or audit', async () => {
    await expect(
      new CitySubmissionEligibilityRepository().saveVerification({
        applicationId: 'application-1',
        decision: ApplicationEligibilityVerificationDecision.APPROVED,
        reason: 'Roster evidence verified.',
        verificationBasisHash: 'basis-hash',
        actorId: 'city-manager',
        actorRole: Role.city_manager,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'APPLICATION_CANCELLED',
      message: 'Hồ sơ đã bị hủy. Mở lại hồ sơ trước khi tiếp tục xử lý.',
    });
    expect(tx.application.update).not.toHaveBeenCalled();
    expect(tx.applicationEligibilityVerification.upsert).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('stops City task assignment after cancellation before task/audit/notification writes', async () => {
    mocks.reviewTask.findUnique.mockResolvedValue({
      id: 'task-1',
      workspaceId: 'school-1',
      workspace: { type: WorkspaceType.SCHOOL, isActive: true },
      criterion: Criterion.academic,
      assignedOfficerId: null,
      applicationId: 'application-1',
      collectiveProfileId: null,
      application: { applicationType: ApplicationType.individual, targetLevel: Level.city, student: { faculty: 'Faculty A' } },
      collectiveProfile: null,
    });
    mocks.user.findUnique.mockResolvedValue({
      id: 'city-officer-1',
      role: Role.city_officer,
      workspaceId: 'city-workspace',
      workspace: { type: WorkspaceType.CITY, isActive: true },
      isActive: true,
      officerSpecializations: [{ criterion: Criterion.academic, facultyScope: null }],
    });

    await expect(
      new ManagerService().assignTask(cityManager as never, 'task-1', {
        assignedOfficerId: 'city-officer-1',
      } as never),
    ).rejects.toMatchObject({ statusCode: 409, code: 'APPLICATION_CANCELLED' });
    expect(tx.reviewTask.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
  });

  it('stops aggregate writes after cancellation but leaves aggregate reads available without audit', async () => {
    mocks.application.findUnique.mockResolvedValue(cityApplication());
    const manager = new ManagerService();

    await expect(
      manager.aggregateApplication(cityManager as never, 'application-1', {} as never),
    ).rejects.toMatchObject({ statusCode: 409, code: 'APPLICATION_CANCELLED' });
    expect(tx.application.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();

    mocks.$transaction.mockClear();
    mocks.application.findUnique.mockResolvedValue(cityApplication() as never);
    const cancelled = { ...cityApplication(), cancelledAt: new Date() };
    mocks.application.findUnique.mockResolvedValue(cancelled as never);
    await expect(manager.getAggregation(cityManager as never, 'application-1')).resolves.toMatchObject({
      application: { id: 'application-1' },
    });
    expect(mocks.$transaction).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('skips aggregation audit when cancellation wins between the read and audit lock', async () => {
    mocks.application.findUnique.mockResolvedValue(cityApplication());

    await expect(
      new ManagerService().getAggregation(cityManager as never, 'application-1'),
    ).resolves.toMatchObject({ application: { id: 'application-1' } });

    expect(mocks.$transaction).toHaveBeenCalledOnce();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('rechecks cancellation under the finalization lock before cascade/final/audit/notification writes', async () => {
    const active = cityApplication();
    mocks.application.findUnique.mockResolvedValue(active as never);
    const enqueue = vi.fn();
    const manager = new ManagerService({ enqueue } as never);
    vi.spyOn(manager, 'getAggregation').mockResolvedValue({
      application: active,
      canFinalize: true,
      reviewProgress: { totalTasks: 5, accepted: 5, rejected: 0 },
      resolutionSummary: { open: 0 },
      latestCascade: null,
    } as never);

    await expect(
      manager.finalizeApplication(cityManager as never, 'application-1', {
        finalStatus: 'passed',
        finalLevel: Level.city,
        finalNote: 'Decision',
        notifyStudent: true,
      } as never),
    ).rejects.toMatchObject({ statusCode: 409, code: 'APPLICATION_CANCELLED' });
    expect(tx.application.updateMany).not.toHaveBeenCalled();
    expect(tx.application.update).not.toHaveBeenCalled();
    expect(tx.cascadeReview.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it.each([
    ['resolveCase', ResolutionStatus.open],
    ['updateCaseStatus', ResolutionStatus.open],
    ['reopenCase', ResolutionStatus.resolved],
  ] as const)('stops %s before resolution or application writes', async (method, status) => {
    const record = resolutionCase(status);
    mocks.resolutionCase.findUnique.mockResolvedValue(record);
    const service = new ResolutionService();
    const cityManager = {
      id: 'city-manager',
      role: Role.city_manager,
      workspaceId: 'city-workspace',
      workspace: {
        id: 'city-workspace',
        code: 'DANANG_CITY',
        name: 'Da Nang',
        shortName: 'Da Nang',
        type: WorkspaceType.CITY,
      },
    };
    const operation =
      method === 'resolveCase'
        ? service.resolveCase(cityManager as never, 'case-1', {
            decision: 'closed_no_action',
            note: 'Reviewed with no further action.',
            evidenceDecisions: [],
          } as never)
        : method === 'updateCaseStatus'
          ? service.updateCaseStatus(cityManager as never, 'case-1', {
              status: 'in_review',
              note: 'Still being reviewed.',
            } as never)
          : service.reopenCase(cityManager as never, 'case-1', {
              reason: 'Appeal accepted.',
            } as never);

    await expect(operation).rejects.toMatchObject({
      statusCode: 409,
      code: 'APPLICATION_CANCELLED',
      message: 'Hồ sơ đã bị hủy. Mở lại hồ sơ trước khi tiếp tục xử lý.',
    });
    expect(tx.resolutionCase.update).not.toHaveBeenCalled();
    expect(tx.application.update).not.toHaveBeenCalled();
    expect(tx.reviewTask.update).not.toHaveBeenCalled();
    expect(tx.evidence.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
  });
});

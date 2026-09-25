import { ApplicationStatus, ApplicationType, Level, Role } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../src/shared/types/auth';

const mocks = vi.hoisted(() => ({
  prisma: {
    application: { findUnique: vi.fn(), update: vi.fn() },
    precheckResult: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
  notifications: { create: vi.fn() },
  emailOutbox: { enqueue: vi.fn() },
  precheck: {
    run: vi.fn(),
    prepareForSubmission: vi.fn(),
    persistPreparedInTransaction: vi.fn(),
  },
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({ prisma: mocks.prisma }));

import { CitySubmissionEligibilityService } from '../../src/modules/applications/city-submission-eligibility.service';
import { ApplicationsService } from '../../src/modules/applications/applications.service';

const student = {
  id: 'student-a',
  workspaceId: 'school-a',
  email: 'student-a@example.test',
  role: Role.student,
  fullName: 'Student A',
  studentCode: '000123',
  className: '24CTT1',
  faculty: null,
  avatarUrl: null,
  workspace: {
    id: 'school-a',
    code: 'SCHOOL_A',
    type: 'SCHOOL',
    name: 'School A',
    shortName: 'A',
  },
} as unknown as AuthenticatedUser;

const cityManager = {
  ...student,
  id: 'city-manager',
  workspaceId: 'city-workspace',
  role: Role.city_manager,
  workspace: {
    id: 'city-workspace',
    code: 'DANANG_CITY',
    type: 'CITY',
    name: 'Da Nang',
    shortName: 'Da Nang',
  },
} as unknown as AuthenticatedUser;

function application(overrides: Record<string, unknown> = {}) {
  return {
    id: 'application-a',
    workspaceId: 'school-a',
    studentId: 'student-a',
    schoolYear: '2025-2026',
    applicationType: ApplicationType.individual,
    targetLevel: Level.city,
    status: ApplicationStatus.ready_to_submit,
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    submittedAt: null,
    currentDraftVersion: 1,
    readinessScore: 100,
    student: { id: 'student-a', email: 'student-a@example.test', fullName: 'Student A' },
    evidences: [],
    metrics: [],
    requirementResponses: [],
    reviewTasks: [],
    ...overrides,
  };
}

function eligibilityService(input: {
  parentWorkspaceId: string | null;
  recipients: Array<{ studentCode: string; fullName: string; className: string }>;
}) {
  const state: {
    identity: {
      workspaceId: string;
      studentCode: string | null;
      fullName: string;
      className: string | null;
    };
    manualVerification: { decision: string; verificationBasisHash: string | null } | null;
  } = {
    identity: {
      workspaceId: 'school-a',
      studentCode: '000123',
      fullName: 'Student A',
      className: '24CTT1',
    },
    manualVerification: null,
  };
  const repository = {
    state,
    findApplication: vi.fn().mockResolvedValue({
      id: 'application-a',
      studentId: 'student-a',
      workspaceId: 'school-a',
      schoolYear: '2025-2026',
    }),
    findWorkspaceContext: vi.fn().mockResolvedValue({
      id: 'school-a',
      type: 'SCHOOL',
      parentWorkspaceId: input.parentWorkspaceId,
      parentWorkspace: input.parentWorkspaceId
        ? { id: input.parentWorkspaceId, type: 'UNIVERSITY_SYSTEM' }
        : null,
    }),
    findConfirmedUniversityRecipients: vi.fn().mockResolvedValue(input.recipients),
    findManualVerification: vi.fn().mockImplementation(async () => state.manualVerification),
    findApplicationForVerification: vi.fn().mockResolvedValue({
      id: 'application-a',
      studentId: 'student-a',
      workspaceId: 'school-a',
      schoolYear: '2025-2026',
      applicationType: 'individual',
      targetLevel: 'city',
      status: 'ready_to_submit',
      submittedAt: null,
      workspace: { type: 'SCHOOL', isActive: true },
    }),
    findStudentIdentity: vi.fn().mockImplementation(async () => state.identity),
    saveVerification: vi.fn().mockImplementation(async (value) => {
      state.manualVerification = {
        decision: value.decision,
        verificationBasisHash: value.verificationBasisHash,
      };
      return value;
    }),
  };
  return {
    service: new CitySubmissionEligibilityService(repository as never),
    repository,
  };
}

async function approveManualEligibility(
  eligibility: CitySubmissionEligibilityService,
  repository: ReturnType<typeof eligibilityService>['repository'],
) {
  repository.state.identity = {
    workspaceId: 'school-a',
    studentCode: null,
    fullName: 'Student A',
    className: '24CTT1',
  };
  await eligibility.verifyEligibility(cityManager, 'application-a', {
    decision: 'APPROVED',
    reason: 'Verified against the official signed decision.',
  });
}

function buildService(eligibility: CitySubmissionEligibilityService) {
  return new ApplicationsService(
    {} as never,
    mocks.notifications as never,
    {} as never,
    mocks.emailOutbox as never,
    mocks.precheck as never,
    eligibility,
  );
}

function configureSuccessfulTransaction(updateCount = 1) {
  const task = {
    id: 'review-task-a',
    criterion: 'ethics',
    status: 'waiting',
    assignedOfficer: { id: 'officer-a', fullName: 'Officer A' },
  };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'application-a', studentId: 'student-a' }]),
    application: {
      findUnique: vi.fn().mockResolvedValue({ workspaceId: 'school-a' }),
      updateMany: vi.fn().mockResolvedValue({ count: updateCount }),
    },
    applicationDraftSnapshot: { create: vi.fn().mockResolvedValue({}) },
    reviewTask: { findMany: vi.fn().mockResolvedValue([task]) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  mocks.prisma.$transaction.mockImplementation(async (callback) => callback(tx));
  mocks.notifications.create.mockResolvedValue({ id: 'notification-a' });
  return tx;
}

describe('ApplicationsService City submission eligibility gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.application.findUnique.mockResolvedValue(application());
    mocks.prisma.precheckResult.findFirst.mockResolvedValue({
      createdAt: new Date('2026-09-02T00:00:00.000Z'),
      resultJson: null,
      missingItemsJson: null,
    });
    mocks.prisma.$transaction.mockRejectedValue(new Error('submit transaction reached'));
  });

  it('blocks an ineligible initial City submission before precheck or submission side effects', async () => {
    const { service: eligibility, repository } = eligibilityService({
      parentWorkspaceId: 'udn',
      recipients: [],
    });
    const original = application();
    mocks.prisma.application.findUnique.mockResolvedValue(original);

    await expect(
      buildService(eligibility).submit(student, 'application-a', { allowSubmitWithWarnings: true }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'CITY_SUBMISSION_NOT_ELIGIBLE',
    });

    expect(repository.findApplication).toHaveBeenCalledWith('application-a');
    expect(repository.findConfirmedUniversityRecipients).toHaveBeenCalledWith({
      issuerWorkspaceId: 'udn',
      institutionWorkspaceId: 'school-a',
      schoolYear: '2025-2026',
    });
    expect(mocks.precheck.run).not.toHaveBeenCalled();
    expect(mocks.prisma.precheckResult.findFirst).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.prisma.application.update).not.toHaveBeenCalled();
    expect(mocks.notifications.create).not.toHaveBeenCalled();
    expect(mocks.emailOutbox.enqueue).not.toHaveBeenCalled();
    expect(original.status).toBe(ApplicationStatus.ready_to_submit);
    expect(original.submittedAt).toBeNull();
  });

  it('blocks NEEDS_VERIFICATION with a distinct message before creating ReviewTasks', async () => {
    const { service: eligibility } = eligibilityService({
      parentWorkspaceId: 'udn',
      recipients: [{ studentCode: '999999', fullName: 'Student A', className: '24CTT1' }],
    });

    await expect(
      buildService(eligibility).submit({ ...student, studentCode: null } as never, 'application-a', {
        allowSubmitWithWarnings: true,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'CITY_SUBMISSION_NEEDS_VERIFICATION',
      message: 'Hệ thống chưa thể tự động xác minh thông tin của bạn với danh sách công nhận. Hồ sơ cần được kiểm tra lại.',
    });

    expect(mocks.prisma.precheckResult.findFirst).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.notifications.create).not.toHaveBeenCalled();
  });

  it('allows a City Manager approval to clear NEEDS_VERIFICATION for submit', async () => {
    const { service: eligibility, repository } = eligibilityService({
      parentWorkspaceId: 'udn',
      recipients: [{ studentCode: '999999', fullName: 'Student A', className: '24CTT1' }],
    });
    await approveManualEligibility(eligibility, repository);
    configureSuccessfulTransaction();
    mocks.prisma.application.findUnique.mockResolvedValue(
      application({
        reviewTasks: [
          { id: 'review-task-a', criterion: 'ethics', status: 'waiting', assignedOfficer: null },
        ],
      }),
    );

    const result = await buildService(eligibility).submit({ ...student, studentCode: null }, 'application-a', {
      allowSubmitWithWarnings: true,
    });

    expect(result.application.status).toBe('under_review');
    expect(repository.findManualVerification).toHaveBeenCalledWith('application-a');
    expect(mocks.notifications.create).toHaveBeenCalledOnce();
  });

  it('blocks a City Manager rejection with the definitive not-eligible submit code', async () => {
    const { service: eligibility, repository } = eligibilityService({
      parentWorkspaceId: 'udn',
      recipients: [{ studentCode: '999999', fullName: 'Student A', className: '24CTT1' }],
    });
    repository.state.identity = {
      workspaceId: 'school-a',
      studentCode: null,
      fullName: 'Student A',
      className: '24CTT1',
    };
    await eligibility.verifyEligibility(cityManager, 'application-a', {
      decision: 'REJECTED',
      reason: 'The identity could not be verified.',
    });

    await expect(
      buildService(eligibility).submit({ ...student, studentCode: null }, 'application-a', {
        allowSubmitWithWarnings: true,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'CITY_SUBMISSION_NOT_ELIGIBLE',
    });

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.notifications.create).not.toHaveBeenCalled();
  });

  it('submits a DIRECT_CITY application without querying Award Registry', async () => {
    const { service: eligibility, repository } = eligibilityService({
      parentWorkspaceId: null,
      recipients: [],
    });
    const tx = configureSuccessfulTransaction();
    mocks.prisma.application.findUnique.mockResolvedValue(
      application({
        reviewTasks: [
          { id: 'review-task-a', criterion: 'ethics', status: 'waiting', assignedOfficer: null },
        ],
      }),
    );

    const result = await buildService(eligibility).submit(student, 'application-a', {
      allowSubmitWithWarnings: true,
    });

    expect(result.application.status).toBe('under_review');
    expect(result.reviewTasks).toHaveLength(1);
    expect(repository.findConfirmedUniversityRecipients).not.toHaveBeenCalled();
    expect(tx.application.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'application-a',
        status: ApplicationStatus.ready_to_submit,
        targetLevel: Level.city,
      }),
      data: expect.objectContaining({ status: 'under_review' }),
    });
    expect(mocks.notifications.create).toHaveBeenCalledOnce();
  });

  it('rejects if the target level changed from School to City while submit was preparing', async () => {
    const { service: eligibility, repository } = eligibilityService({
      parentWorkspaceId: 'udn',
      recipients: [],
    });
    mocks.prisma.application.findUnique
      .mockResolvedValueOnce(
        application({
          targetLevel: Level.school,
          status: ApplicationStatus.draft,
          updatedAt: new Date('2026-09-01T00:00:00.000Z'),
        }),
      )
      .mockResolvedValueOnce(
        application({
          targetLevel: Level.city,
          status: ApplicationStatus.ready_to_submit,
          currentDraftVersion: 2,
          updatedAt: new Date('2026-09-02T00:00:00.000Z'),
        }),
      );
    mocks.prisma.precheckResult.findFirst.mockResolvedValue({
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      resultJson: null,
      missingItemsJson: null,
    });

    await expect(
      buildService(eligibility).submit(student, 'application-a', { allowSubmitWithWarnings: true }),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(repository.findConfirmedUniversityRecipients).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.notifications.create).not.toHaveBeenCalled();
  });

  it('uses the application version updated by its own stale precheck refresh', async () => {
    const { service: eligibility } = eligibilityService({ parentWorkspaceId: null, recipients: [] });
    const beforePrecheck = application({
      status: ApplicationStatus.draft,
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      reviewTasks: [
        { id: 'review-task-a', criterion: 'ethics', status: 'waiting', assignedOfficer: null },
      ],
    });
    const afterPrecheck = application({
      status: ApplicationStatus.ready_to_submit,
      updatedAt: new Date('2026-09-03T00:00:00.000Z'),
      reviewTasks: [
        { id: 'review-task-a', criterion: 'ethics', status: 'waiting', assignedOfficer: null },
      ],
    });
    const tx = configureSuccessfulTransaction();
    mocks.prisma.application.findUnique
      .mockResolvedValueOnce(beforePrecheck)
      .mockResolvedValueOnce(afterPrecheck);
    mocks.prisma.precheckResult.findFirst
      .mockResolvedValueOnce({ createdAt: new Date('2026-08-31T00:00:00.000Z') })
      .mockResolvedValueOnce({
        createdAt: afterPrecheck.updatedAt,
        resultJson: null,
        missingItemsJson: null,
      });
    mocks.precheck.run.mockResolvedValue({});

    const result = await buildService(eligibility).submit(student, 'application-a', {
      allowSubmitWithWarnings: true,
    });

    expect(result.application.status).toBe('under_review');
    expect(tx.application.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        status: ApplicationStatus.ready_to_submit,
        updatedAt: afterPrecheck.updatedAt,
      }),
      data: expect.objectContaining({ status: 'under_review' }),
    });
  });

  it('submits an exact confirmed UDN match through the existing transaction', async () => {
    const { service: eligibility, repository } = eligibilityService({
      parentWorkspaceId: 'udn',
      recipients: [{ studentCode: '000123', fullName: 'Student A', className: '24CTT1' }],
    });
    const tx = configureSuccessfulTransaction();
    mocks.prisma.application.findUnique.mockResolvedValue(
      application({
        reviewTasks: [
          { id: 'review-task-a', criterion: 'ethics', status: 'waiting', assignedOfficer: null },
        ],
      }),
    );

    const result = await buildService(eligibility).submit(student, 'application-a', {
      allowSubmitWithWarnings: true,
    });

    expect(result.application.status).toBe('under_review');
    expect(result.reviewTasks).toHaveLength(1);
    expect(repository.findConfirmedUniversityRecipients).toHaveBeenCalledWith({
      issuerWorkspaceId: 'udn',
      institutionWorkspaceId: 'school-a',
      schoolYear: '2025-2026',
    });
    expect(tx.application.updateMany).toHaveBeenCalledOnce();
    expect(mocks.notifications.create).toHaveBeenCalledOnce();
  });

  it('stops before review writes when manual eligibility changed after its check', async () => {
    const { service: eligibility, repository } = eligibilityService({
      parentWorkspaceId: 'udn',
      recipients: [{ studentCode: '999999', fullName: 'Student A', className: '24CTT1' }],
    });
    await approveManualEligibility(eligibility, repository);
    const tx = configureSuccessfulTransaction(0);
    mocks.prisma.application.findUnique.mockResolvedValue(application());

    await expect(
      buildService(eligibility).submit(
        { ...student, studentCode: null } as never,
        'application-a',
        { allowSubmitWithWarnings: true },
      ),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(tx.application.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ updatedAt: application().updatedAt }),
      data: expect.objectContaining({ status: 'under_review' }),
    });
    expect(tx.applicationDraftSnapshot.create).not.toHaveBeenCalled();
    expect(tx.reviewTask.findMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(mocks.notifications.create).not.toHaveBeenCalled();
    expect(mocks.emailOutbox.enqueue).not.toHaveBeenCalled();
  });

  it('rechecks identity under the submit transaction before committing review', async () => {
    const { service: eligibility, repository } = eligibilityService({
      parentWorkspaceId: 'udn',
      recipients: [
        { studentCode: '111111', fullName: 'Student A', className: '24CTT1' },
        { studentCode: '222222', fullName: 'Student B', className: '24CTT1' },
      ],
    });
    await approveManualEligibility(eligibility, repository);
    const tx = configureSuccessfulTransaction();
    mocks.prisma.application.findUnique.mockResolvedValue(
      application({
        reviewTasks: [
          { id: 'review-task-a', criterion: 'ethics', status: 'waiting', assignedOfficer: null },
        ],
      }),
    );
    mocks.prisma.$transaction.mockImplementation(async (callback) => {
      repository.state.identity = { ...repository.state.identity, fullName: 'Student B' };
      return callback(tx);
    });

    await expect(
      buildService(eligibility).submit(
        { ...student, studentCode: null },
        'application-a',
        { allowSubmitWithWarnings: true },
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'CITY_SUBMISSION_NEEDS_VERIFICATION',
    });

    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.application.updateMany).not.toHaveBeenCalled();
    expect(tx.applicationDraftSnapshot.create).not.toHaveBeenCalled();
    expect(tx.reviewTask.findMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(mocks.notifications.create).not.toHaveBeenCalled();
    expect(mocks.emailOutbox.enqueue).not.toHaveBeenCalled();
  });

  it('rolls back submit-triggered precheck writes when eligibility changes before the protected commit', async () => {
    const { service: eligibility, repository } = eligibilityService({
      parentWorkspaceId: 'udn',
      recipients: [{ studentCode: '111111', fullName: 'Student A', className: '24CTT1' }],
    });
    await approveManualEligibility(eligibility, repository);
    const actor = { ...student, studentCode: null };
    const precheckWrites: string[] = [];
    const preparedPrecheck = {
      application: application(),
      level: Level.city,
      criteria: { criteriaVersionId: null, versionName: 'fallback-city', schoolYear: '2025-2026', unitScope: 'default', level: Level.city, isFallback: true, warnings: [], rules: [] },
      completion: [],
      result: {
        applicationId: 'application-a',
        level: Level.city,
        readinessScore: 100,
        readyToSubmit: true,
        criteriaResults: [],
        missingItems: [],
        warnings: [],
        nextBestAction: '',
        nextAction: null,
        humanConfirmationRequired: true,
      },
    };
    mocks.prisma.application.findUnique.mockResolvedValue(application());
    mocks.prisma.precheckResult.findFirst.mockResolvedValue({
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      resultJson: null,
      missingItemsJson: null,
    });
    mocks.precheck.run.mockImplementation(async () => {
      actor.fullName = 'No Matching Recipient';
      precheckWrites.push('persisted');
      return {};
    });
    mocks.precheck.prepareForSubmission.mockImplementation(async () => {
      repository.state.identity = {
        ...repository.state.identity,
        fullName: 'No Matching Recipient',
      };
      return preparedPrecheck;
    });
    const tx = configureSuccessfulTransaction();

    await expect(
      buildService(eligibility).submit(actor, 'application-a', { allowSubmitWithWarnings: true }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'CITY_SUBMISSION_NOT_ELIGIBLE',
    });

    expect(precheckWrites).toEqual([]);
    expect(mocks.precheck.run).not.toHaveBeenCalled();
    expect(mocks.precheck.persistPreparedInTransaction).not.toHaveBeenCalled();
    expect(tx.application.updateMany).not.toHaveBeenCalled();
    expect(tx.applicationDraftSnapshot.create).not.toHaveBeenCalled();
    expect(tx.reviewTask.findMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(mocks.notifications.create).not.toHaveBeenCalled();
    expect(mocks.emailOutbox.enqueue).not.toHaveBeenCalled();
  });

  it('does not let supplement_required bypass eligibility before the first submission', async () => {
    const { service: eligibility, repository } = eligibilityService({
      parentWorkspaceId: 'udn',
      recipients: [],
    });
    const original = application({ status: ApplicationStatus.supplement_required });
    mocks.prisma.application.findUnique.mockResolvedValue(original);

    await expect(
      buildService(eligibility).submit(student, 'application-a', { allowSubmitWithWarnings: true }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'CITY_SUBMISSION_NOT_ELIGIBLE',
    });

    expect(repository.findApplication).toHaveBeenCalledOnce();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.notifications.create).not.toHaveBeenCalled();
    expect(original.status).toBe(ApplicationStatus.supplement_required);
    expect(original.submittedAt).toBeNull();
  });

  it('does not reapply the initial eligibility gate to an actual supplement resubmission', async () => {
    const { service: eligibility, repository } = eligibilityService({
      parentWorkspaceId: 'udn',
      recipients: [],
    });
    mocks.prisma.application.findUnique.mockResolvedValue(
      application({
        status: ApplicationStatus.supplement_required,
        submittedAt: new Date('2026-09-01T00:00:00.000Z'),
      }),
    );

    await expect(
      buildService(eligibility).submit(student, 'application-a', { allowSubmitWithWarnings: true }),
    ).rejects.toThrow('submit transaction reached');

    expect(repository.findApplication).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).toHaveBeenCalledOnce();
  });

  it.each([
    ['school-level individual submission', student, { targetLevel: Level.school }],
    ['collective City submission', student, { applicationType: ApplicationType.collective }],
    ['admin utility submission', { ...student, role: Role.admin }, {}],
  ] as const)('does not gate %s', async (_caseName, actor, applicationChanges) => {
    const { service: eligibility, repository } = eligibilityService({
      parentWorkspaceId: 'udn',
      recipients: [],
    });
    mocks.prisma.application.findUnique.mockResolvedValue(application(applicationChanges));

    await expect(
      buildService(eligibility).submit(actor as never, 'application-a', {
        allowSubmitWithWarnings: true,
      }),
    ).rejects.toThrow('submit transaction reached');

    expect(repository.findApplication).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).toHaveBeenCalledOnce();
  });
});

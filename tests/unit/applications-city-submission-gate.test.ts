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
  precheck: { run: vi.fn() },
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
  const repository = {
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
    findManualVerification: vi.fn().mockResolvedValue(null),
  };
  return {
    service: new CitySubmissionEligibilityService(repository as never),
    repository,
  };
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
    repository.findManualVerification.mockResolvedValue({ decision: 'APPROVED' });
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
    repository.findManualVerification.mockResolvedValue({ decision: 'REJECTED' });

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
    repository.findManualVerification.mockResolvedValue({ decision: 'APPROVED' });
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

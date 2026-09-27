import { ApplicationStatus, ApplicationType, Level, Role, WorkspaceType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../src/shared/types/auth';

const mocks = vi.hoisted(() => ({
  cityReviewSeason: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  citySubmissionWindowException: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
  application: { findFirst: vi.fn() },
  auditLog: { create: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({ prisma: mocks }));

import { CityReviewSeasonsService } from '../../src/modules/manager/city-review-seasons.service';
import {
  cityReviewSeasonCreateSchema,
  cityReviewSeasonUpdateSchema,
  submissionWindowExceptionSchema,
} from '../../src/modules/manager/manager.validation';

const cityManager: AuthenticatedUser = {
  id: 'city-manager',
  email: 'manager@city.test',
  fullName: 'City Manager',
  role: Role.city_manager,
  workspaceId: 'city-workspace',
  workspace: {
    id: 'city-workspace',
    code: 'DANANG_CITY',
    type: WorkspaceType.CITY,
    name: 'Da Nang',
    shortName: 'Da Nang',
  },
  studentCode: null,
  className: null,
  faculty: null,
  avatarUrl: null,
};

const student: AuthenticatedUser = {
  ...cityManager,
  id: 'student-a',
  email: 'student@school.test',
  fullName: 'Student A',
  role: Role.student,
  workspaceId: 'school-a',
  workspace: {
    id: 'school-a',
    code: 'SCHOOL_A',
    type: WorkspaceType.SCHOOL,
    name: 'School A',
    shortName: 'A',
  },
};

const season = {
  id: 'season-1',
  schoolYear: '2026-2027',
  submissionOpensAt: new Date('2026-09-01T00:00:00.000Z'),
  submissionClosesAt: new Date('2026-10-01T00:00:00.000Z'),
  reviewDeadlineAt: new Date('2026-11-01T00:00:00.000Z'),
  supplementDeadlineAt: new Date('2026-12-01T00:00:00.000Z'),
  finalizationDeadlineAt: new Date('2027-01-01T00:00:00.000Z'),
  version: 1,
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
};

function initialApplication(overrides: Record<string, unknown> = {}) {
  return {
    id: 'application-a',
    studentId: 'student-a',
    workspaceId: 'school-a',
    schoolYear: season.schoolYear,
    applicationType: ApplicationType.individual,
    targetLevel: Level.city,
    status: ApplicationStatus.draft,
    submittedAt: null,
    workspace: { type: WorkspaceType.SCHOOL, isActive: true },
    ...overrides,
  };
}

describe('City review season API validation', () => {
  it('requires explicit timezone offsets for every supplied timestamp', () => {
    const base = {
      schoolYear: '2026-2027',
      submissionOpensAt: '2026-09-01T00:00:00Z',
      submissionClosesAt: '2026-10-01T00:00:00Z',
      reviewDeadlineAt: null,
      supplementDeadlineAt: null,
      finalizationDeadlineAt: null,
      reason: 'Configure the 2026-2027 season',
    };

    expect(cityReviewSeasonCreateSchema.safeParse(base).success).toBe(true);
    expect(
      cityReviewSeasonCreateSchema.safeParse({
        ...base,
        submissionOpensAt: '2026-09-01T00:00:00',
      }).success,
    ).toBe(false);
    expect(
      cityReviewSeasonCreateSchema.safeParse({
        ...base,
        submissionOpensAt: '2026-10-01T00:00:00Z',
      }).success,
    ).toBe(false);
    expect(
      cityReviewSeasonCreateSchema.safeParse({
        ...base,
        submissionOpensAt: base.submissionClosesAt,
      }).success,
    ).toBe(false);
    expect(
      cityReviewSeasonUpdateSchema.safeParse({ ...base, expectedVersion: 1 }).success,
    ).toBe(true);
    expect(
      submissionWindowExceptionSchema.safeParse({
        validUntil: '2026-10-15T00:00:00+07:00',
        reason: 'Late submission approved',
      }).success,
    ).toBe(true);
  });
});

describe('CityReviewSeasonsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cityReviewSeason.findUnique.mockResolvedValue(season);
    mocks.application.findFirst.mockResolvedValue(initialApplication());
    mocks.citySubmissionWindowException.findUnique.mockResolvedValue(null);
    mocks.$queryRaw.mockResolvedValue([]);
    mocks.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback(mocks),
    );
  });

  it('returns the saved season and computed per-window statuses', async () => {
    const result = await new CityReviewSeasonsService().getSeason(cityManager, '2026-2027', new Date('2026-09-15T00:00:00Z'));

    expect(result).toMatchObject({
      id: 'season-1',
      schoolYear: '2026-2027',
      version: 1,
      submissionStatus: 'OPEN',
      reviewStatus: 'ON_TRACK',
      supplementStatus: 'ON_TRACK',
      finalizationStatus: 'ON_TRACK',
    });
  });

  it('allows City Managers in CITY and admins while denying review, uploader, student, and legacy roles', async () => {
    const service = new CityReviewSeasonsService();
    const deniedUsers = [
      { ...cityManager, role: Role.city_officer },
      { ...cityManager, role: Role.city_committee },
      { ...cityManager, role: Role.data_uploader },
      { ...cityManager, role: Role.manager },
      { ...cityManager, role: Role.committee },
      student,
      { ...cityManager, workspace: { ...cityManager.workspace!, type: WorkspaceType.SCHOOL } },
    ];

    for (const user of deniedUsers) {
      await expect(service.getSeason(user, '2026-2027')).rejects.toMatchObject({ statusCode: 403 });
    }
    expect(mocks.cityReviewSeason.findUnique).not.toHaveBeenCalled();

    await expect(
      service.getSeason({ ...cityManager, role: Role.admin }, '2026-2027'),
    ).resolves.toMatchObject({ schoolYear: '2026-2027' });
    await expect(service.getSeason(cityManager, '2026-2027')).resolves.toMatchObject({
      schoolYear: '2026-2027',
    });
    expect(mocks.cityReviewSeason.findUnique).toHaveBeenCalledTimes(2);
  });

  it('does not create configuration or write audit records for unauthorized users', async () => {
    await expect(
      new CityReviewSeasonsService().createSeason(student, {
        schoolYear: '2026-2027',
        submissionOpensAt: null,
        submissionClosesAt: null,
        reviewDeadlineAt: null,
        supplementDeadlineAt: null,
        finalizationDeadlineAt: null,
        reason: 'Configure season',
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.cityReviewSeason.create).not.toHaveBeenCalled();
    expect(mocks.auditLog.create).not.toHaveBeenCalled();
  });

  it('uses expectedVersion for updates and writes field-level audits in the transaction', async () => {
    mocks.cityReviewSeason.updateMany.mockResolvedValue({ count: 1 });
    mocks.cityReviewSeason.findUnique.mockResolvedValueOnce(season).mockResolvedValueOnce({
      ...season,
      version: 2,
      submissionClosesAt: new Date('2026-10-15T00:00:00.000Z'),
    });
    const result = await new CityReviewSeasonsService().updateSeason(cityManager, '2026-2027', {
      submissionOpensAt: season.submissionOpensAt.toISOString(),
      submissionClosesAt: '2026-10-15T00:00:00Z',
      reviewDeadlineAt: null,
      supplementDeadlineAt: null,
      finalizationDeadlineAt: null,
      expectedVersion: 1,
      reason: 'Extend submission window',
    });

    expect(result.version).toBe(2);
    expect(mocks.cityReviewSeason.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { schoolYear: '2026-2027', version: 1 } }),
    );
    expect(mocks.auditLog.create).toHaveBeenCalledTimes(1);
    expect(mocks.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'CITY_REVIEW_SEASON_FIELD_UPDATED',
      targetType: 'city_review_season',
      note: 'Extend submission window',
    });
  });

  it('rejects stale season versions without leaving an audit record', async () => {
    mocks.cityReviewSeason.findUnique.mockResolvedValue(season);
    mocks.cityReviewSeason.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      new CityReviewSeasonsService().updateSeason(cityManager, '2026-2027', {
        submissionOpensAt: season.submissionOpensAt.toISOString(),
        submissionClosesAt: season.submissionClosesAt.toISOString(),
        reviewDeadlineAt: season.reviewDeadlineAt.toISOString(),
        supplementDeadlineAt: season.supplementDeadlineAt.toISOString(),
        finalizationDeadlineAt: season.finalizationDeadlineAt.toISOString(),
        expectedVersion: 0,
        reason: 'Stale update',
      }),
    ).rejects.toMatchObject({ code: 'CITY_REVIEW_SEASON_VERSION_CONFLICT' });
    expect(mocks.auditLog.create).not.toHaveBeenCalled();
  });

  it('fails closed when initial City submission has no configured season', async () => {
    const result = await CityReviewSeasonsService.assertInitialSubmissionWindowOpen(
      { $queryRaw: vi.fn().mockResolvedValue([]) } as never,
      initialApplication(),
      new Date('2026-09-15T00:00:00Z'),
    ).catch((error: unknown) => error);

    expect(result).toMatchObject({ code: 'CITY_SUBMISSION_WINDOW_NOT_CONFIGURED' });
  });

  it('keeps the opening, configured close, and exception-adjusted close inclusive', async () => {
    const tx = { $queryRaw: vi.fn() };
    const activeException = {
      validUntil: new Date('2026-10-15T00:00:00.000Z'),
      revokedAt: null,
    };

    tx.$queryRaw.mockResolvedValueOnce([season]).mockResolvedValueOnce([activeException]);
    await expect(
      CityReviewSeasonsService.assertInitialSubmissionWindowOpen(
        tx as never,
        initialApplication(),
        season.submissionOpensAt,
      ),
    ).resolves.toBeUndefined();
    tx.$queryRaw.mockResolvedValueOnce([season]).mockResolvedValueOnce([]);
    await expect(
      CityReviewSeasonsService.assertInitialSubmissionWindowOpen(
        tx as never,
        initialApplication(),
        season.submissionClosesAt,
      ),
    ).resolves.toBeUndefined();
    tx.$queryRaw.mockResolvedValueOnce([season]).mockResolvedValueOnce([]);
    await expect(
      CityReviewSeasonsService.assertInitialSubmissionWindowOpen(
        tx as never,
        initialApplication(),
        new Date(season.submissionClosesAt.getTime() + 1),
      ),
    ).rejects.toMatchObject({ code: 'CITY_SUBMISSION_CLOSED' });
    tx.$queryRaw.mockResolvedValueOnce([season]).mockResolvedValueOnce([activeException]);
    await expect(
      CityReviewSeasonsService.assertInitialSubmissionWindowOpen(
        tx as never,
        initialApplication(),
        new Date('2026-10-15T00:00:00.000Z'),
      ),
    ).resolves.toBeUndefined();
    tx.$queryRaw.mockResolvedValueOnce([season]).mockResolvedValueOnce([]);
    await expect(
      CityReviewSeasonsService.assertInitialSubmissionWindowOpen(
        tx as never,
        initialApplication(),
        new Date('2026-08-31T23:59:59.999Z'),
      ),
    ).rejects.toMatchObject({ code: 'CITY_SUBMISSION_NOT_OPEN' });
  });

  it('ignores revoked or expired exceptions when checking the close boundary', async () => {
    const tx = { $queryRaw: vi.fn() };
    tx.$queryRaw.mockResolvedValueOnce([season]).mockResolvedValueOnce([{
      validUntil: new Date('2026-10-15T00:00:00.000Z'),
      revokedAt: new Date('2026-10-01T00:00:00.000Z'),
    }]);
    await expect(
      CityReviewSeasonsService.assertInitialSubmissionWindowOpen(
        tx as never,
        initialApplication(),
        new Date('2026-10-02T00:00:00.000Z'),
      ),
    ).rejects.toMatchObject({ code: 'CITY_SUBMISSION_CLOSED' });

    tx.$queryRaw.mockResolvedValueOnce([season]).mockResolvedValueOnce([{
      validUntil: new Date('2026-09-20T00:00:00.000Z'),
      revokedAt: null,
    }]);
    await expect(
      CityReviewSeasonsService.assertInitialSubmissionWindowOpen(
        tx as never,
        initialApplication(),
        new Date('2026-10-02T00:00:00.000Z'),
      ),
    ).rejects.toMatchObject({ code: 'CITY_SUBMISSION_CLOSED' });
  });

  it('reports exception-active only inside the exception extension interval', async () => {
    const service = new CityReviewSeasonsService();
    const extended = {
      ...initialApplication(),
      submissionWindowException: {
        validUntil: new Date('2026-10-15T00:00:00.000Z'),
        reason: 'Approved late window',
        grantedAt: new Date('2026-10-01T00:00:00.000Z'),
        revokedAt: null,
      },
    };
    mocks.application.findFirst.mockResolvedValue(extended);
    const afterBaseClose = await service.getManagerDeadline(
      cityManager,
      'application-a',
      new Date('2026-10-02T00:00:00.000Z'),
    );
    expect(afterBaseClose.submission.status).toBe('EXCEPTION_ACTIVE');
    expect(afterBaseClose.exception).toEqual({
      validUntil: '2026-10-15T00:00:00.000Z',
      reason: 'Approved late window',
      grantedAt: '2026-10-01T00:00:00.000Z',
      revokedAt: null,
    });
    expect(afterBaseClose).not.toHaveProperty('exception.grantedById');
    expect(afterBaseClose.submission.status).not.toBe('CLOSED');

    const beforeOpen = await service.getManagerDeadline(
      cityManager,
      'application-a',
      new Date('2026-08-31T23:59:59.000Z'),
    );
    expect(beforeOpen.submission.status).toBe('NOT_OPEN');
    const afterException = await service.getManagerDeadline(
      cityManager,
      'application-a',
      new Date('2026-10-15T00:00:00.001Z'),
    );
    expect(afterException.submission.status).toBe('CLOSED');
  });

  it('checks only the supplement deadline for a submitted application being resubmitted', async () => {
    const application = initialApplication({
      submittedAt: new Date('2026-09-10T00:00:00.000Z'),
      status: ApplicationStatus.supplement_required,
    });
    const tx = { $queryRaw: vi.fn().mockResolvedValue([season]) };

    await expect(
      CityReviewSeasonsService.assertSupplementResubmissionBeforeDeadline(
        tx as never,
        application,
        new Date('2026-11-15T00:00:00.000Z'),
      ),
    ).resolves.toBeUndefined();
    await expect(
      CityReviewSeasonsService.assertSupplementResubmissionBeforeDeadline(
        tx as never,
        application,
        new Date('2026-12-02T00:00:00.000Z'),
      ),
    ).rejects.toMatchObject({ code: 'CITY_SUPPLEMENT_WINDOW_CLOSED' });
  });

  it('only returns the deadline DTO for the owning student and active-School applications for City Managers', async () => {
    const service = new CityReviewSeasonsService();
    await service.getStudentDeadline(student, 'application-a');
    expect(mocks.application.findFirst.mock.calls.at(-1)?.[0].where).toMatchObject({
      id: 'application-a',
      studentId: 'student-a',
      workspaceId: 'school-a',
      applicationType: ApplicationType.individual,
      targetLevel: Level.city,
    });
    await service.getManagerDeadline(cityManager, 'application-a');
    expect(mocks.application.findFirst.mock.calls.at(-1)?.[0].where).toMatchObject({
      id: 'application-a',
      applicationType: ApplicationType.individual,
      targetLevel: Level.city,
      workspace: { is: { type: WorkspaceType.SCHOOL, isActive: true } },
    });
  });

  it('denies legacy managers and keeps the student response free of exception reason and actor data', async () => {
    const service = new CityReviewSeasonsService();
    await expect(
      service.getManagerDeadline({ ...cityManager, role: Role.manager }, 'application-a'),
    ).rejects.toMatchObject({ statusCode: 403 });

    const studentDeadline = await service.getStudentDeadline(student, 'application-a');
    expect(studentDeadline).not.toHaveProperty('exception');
    expect(studentDeadline.submission).not.toHaveProperty('reason');
    expect(studentDeadline.submission).not.toHaveProperty('grantedById');
    expect(Object.keys(studentDeadline)).toEqual([
      'applicationId',
      'schoolYear',
      'submission',
      'review',
      'supplement',
      'finalization',
    ]);
  });

  it('records an application-scoped extension without exposing it to any other application', async () => {
    mocks.application.findFirst.mockResolvedValue(initialApplication());
    mocks.citySubmissionWindowException.upsert.mockResolvedValue({
      applicationId: 'application-a',
      validUntil: new Date('2026-10-15T00:00:00.000Z'),
      reason: 'Approved late window',
      grantedAt: new Date('2026-10-01T00:00:00.000Z'),
      revokedAt: null,
    });
    mocks.$queryRaw.mockResolvedValueOnce([{ id: 'application-a' }]).mockResolvedValueOnce([season]);
    const result = await new CityReviewSeasonsService().grantException(
      cityManager,
      'application-a',
      { validUntil: '2026-10-15T00:00:00Z', reason: 'Approved late window' },
    );

    expect(result).toMatchObject({ validUntil: '2026-10-15T00:00:00.000Z' });
    expect(mocks.citySubmissionWindowException.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { applicationId: 'application-a' } }),
    );
    expect(mocks.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'CITY_SUBMISSION_WINDOW_EXCEPTION_GRANTED',
          applicationId: 'application-a',
          note: 'Approved late window',
        }),
      }),
    );
  });

  it('allows an exception for an unsubmitted supplement_required City application', async () => {
    mocks.application.findFirst.mockResolvedValue(
      initialApplication({ status: ApplicationStatus.supplement_required, submittedAt: null }),
    );
    mocks.$queryRaw.mockResolvedValueOnce([{ id: 'application-a' }]).mockResolvedValueOnce([season]);
    mocks.citySubmissionWindowException.upsert.mockResolvedValue({
      applicationId: 'application-a',
      validUntil: new Date('2026-10-15T00:00:00.000Z'),
      reason: 'Allow initial submission',
      grantedAt: new Date(),
      revokedAt: null,
    });

    await expect(
      new CityReviewSeasonsService().grantException(cityManager, 'application-a', {
        validUntil: '2026-10-15T00:00:00Z',
        reason: 'Allow initial submission',
      }),
    ).resolves.toMatchObject({ validUntil: '2026-10-15T00:00:00.000Z' });
    expect(mocks.citySubmissionWindowException.upsert).toHaveBeenCalledOnce();
  });

  it('rejects an exception for an already submitted supplement_required application', async () => {
    mocks.application.findFirst.mockResolvedValue(
      initialApplication({
        status: ApplicationStatus.supplement_required,
        submittedAt: new Date('2026-09-01T00:00:00Z'),
      }),
    );
    mocks.$queryRaw.mockResolvedValueOnce([{ id: 'application-a', cancelledAt: null }]);

    await expect(
      new CityReviewSeasonsService().grantException(cityManager, 'application-a', {
        validUntil: '2026-10-15T00:00:00Z',
        reason: 'Must remain unsubmitted',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.citySubmissionWindowException.upsert).not.toHaveBeenCalled();
  });

  it('rejects grant and revoke after cancellation before exception or audit writes', async () => {
    mocks.$queryRaw.mockResolvedValueOnce([
      { id: 'application-a', cancelledAt: new Date('2026-09-28T00:00:00.000Z') },
    ]);

    await expect(
      new CityReviewSeasonsService().grantException(cityManager, 'application-a', {
        validUntil: '2026-10-15T00:00:00Z',
        reason: 'Grant after cancellation',
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'APPLICATION_CANCELLED' });

    mocks.$queryRaw.mockResolvedValueOnce([
      { id: 'application-a', cancelledAt: new Date('2026-09-28T00:00:00.000Z') },
    ]);
    await expect(
      new CityReviewSeasonsService().revokeException(cityManager, 'application-a', {
        reason: 'Revoke after cancellation',
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'APPLICATION_CANCELLED' });

    expect(mocks.citySubmissionWindowException.upsert).not.toHaveBeenCalled();
    expect(mocks.citySubmissionWindowException.update).not.toHaveBeenCalled();
    expect(mocks.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects a deadline exception that extends the season close but is already expired', async () => {
    const pastSeason = {
      ...season,
      submissionOpensAt: new Date('2026-09-01T00:00:00.000Z'),
      submissionClosesAt: new Date('2026-09-10T00:00:00.000Z'),
    };
    mocks.$queryRaw
      .mockResolvedValueOnce([{ id: 'application-a' }])
      .mockResolvedValueOnce([pastSeason]);

    await expect(
      new CityReviewSeasonsService().grantException(cityManager, 'application-a', {
        validUntil: '2026-09-20T00:00:00Z',
        reason: 'Already expired extension',
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.citySubmissionWindowException.upsert).not.toHaveBeenCalled();
    expect(mocks.auditLog.create).not.toHaveBeenCalled();
  });
});

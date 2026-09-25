import { ApplicationType, Level, Role, WorkspaceType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/shared/errors/app-error';
import { ErrorCodes } from '../../src/shared/errors/error-codes';
import type { AuthenticatedUser } from '../../src/shared/types/auth';

const prismaMock = vi.hoisted(() => ({
  application: { findMany: vi.fn(), count: vi.fn() },
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({ prisma: prismaMock }));

import { CitySubmissionEligibilityService } from '../../src/modules/applications/city-submission-eligibility.service';
import { ManagerService } from '../../src/modules/manager/manager.service';

const cityManager: AuthenticatedUser = {
  id: 'city-manager',
  email: 'manager@city.test',
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
    name: 'Đà Nẵng',
    shortName: 'Đà Nẵng',
    type: WorkspaceType.CITY,
  },
};

function verificationApplication(overrides: Record<string, unknown> = {}) {
  return {
    id: 'application-a',
    studentId: 'student-a',
    workspaceId: 'school-a',
    schoolYear: '2025-2026',
    applicationType: ApplicationType.individual,
    targetLevel: Level.city,
    status: 'ready_to_submit',
    submittedAt: null,
    student: {
      workspaceId: 'school-a',
      fullName: 'Nguyễn Văn A',
      studentCode: '000123',
      className: '24CTT1',
    },
    workspace: {
      id: 'school-a',
      code: 'SCHOOL_A',
      name: 'Trường A',
      shortName: 'A',
      type: WorkspaceType.SCHOOL,
      isActive: true,
      parentWorkspaceId: 'udn',
      parentWorkspace: { id: 'udn', type: WorkspaceType.UNIVERSITY_SYSTEM },
    },
    eligibilityVerification: null,
    ...overrides,
  };
}

function eligibilityRepository() {
  return {
    findApplicationForManagerVerification: vi.fn().mockResolvedValue(verificationApplication()),
    findWorkspaceContext: vi.fn().mockResolvedValue({
      id: 'school-a',
      type: WorkspaceType.SCHOOL,
      parentWorkspaceId: 'udn',
      parentWorkspace: { id: 'udn', type: WorkspaceType.UNIVERSITY_SYSTEM },
    }),
    findConfirmedUniversityRecipients: vi.fn().mockResolvedValue([
      { studentCode: '999999', fullName: ' NGUYỄN   VĂN A ', className: '24CTT1' },
      { studentCode: 'OTHER', fullName: 'Nguyễn Văn B', className: '24CTT1' },
      { studentCode: 'OTHER-CLASS', fullName: 'Nguyễn Văn A', className: '24CTT2' },
    ]),
    findManualVerification: vi.fn().mockResolvedValue(null),
    findManualVerificationForManager: vi.fn().mockResolvedValue(null),
  };
}

describe('City Manager eligibility verification read', () => {
  it('denies non-City-Manager detail access before reading an application', async () => {
    const repository = eligibilityRepository();
    const service = new CitySubmissionEligibilityService(repository as never);

    await expect(
      service.getManagerVerificationDetail({ ...cityManager, role: Role.admin }, 'application-a'),
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect(repository.findApplicationForManagerVerification).not.toHaveBeenCalled();
  });

  it('returns only the scoped identity-signal candidate and safe verification context', async () => {
    const repository = eligibilityRepository();
    const service = new CitySubmissionEligibilityService(repository as never);

    const result = await service.getManagerVerificationDetail(cityManager, 'application-a');

    expect(result).toEqual({
      applicationId: 'application-a',
      schoolYear: '2025-2026',
      route: 'UDN_PREREQUISITE',
      autoStatus: 'NEEDS_VERIFICATION',
      effectiveStatus: 'NEEDS_VERIFICATION',
      reasons: ['IDENTITY_MATCH_REQUIRES_VERIFICATION'],
      student: {
        fullName: 'Nguyễn Văn A',
        studentCode: '000123',
        className: '24CTT1',
      },
      school: { code: 'SCHOOL_A', name: 'Trường A' },
      existingDecision: null,
      candidates: [
        {
          fullName: ' NGUYỄN   VĂN A ',
          studentCode: '999999',
          className: '24CTT1',
          institution: { code: 'SCHOOL_A', name: 'Trường A' },
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('verificationBasisHash');
    expect(result).not.toHaveProperty('existingDecision.reason');
  });

  it('uses City Manager cross-school scope and rejects inactive or unsupported schools', async () => {
    const repository = eligibilityRepository();
    const service = new CitySubmissionEligibilityService(repository as never);
    repository.findApplicationForManagerVerification.mockResolvedValueOnce(
      verificationApplication({
        workspace: { ...verificationApplication().workspace, isActive: false },
      }) as never,
    );

    await expect(
      service.getManagerVerificationDetail(cityManager, 'application-a'),
    ).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(repository.findWorkspaceContext).not.toHaveBeenCalled();
  });

  it.each([
    { applicationType: ApplicationType.collective, submittedAt: null },
    {
      applicationType: ApplicationType.individual,
      submittedAt: new Date('2026-09-01T00:00:00.000Z'),
    },
  ])('rejects non-initial city applications before Award reads', async (overrides) => {
    const repository = eligibilityRepository();
    repository.findApplicationForManagerVerification.mockResolvedValueOnce(
      verificationApplication(overrides) as never,
    );
    const service = new CitySubmissionEligibilityService(repository as never);

    await expect(
      service.getManagerVerificationDetail(cityManager, 'application-a'),
    ).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(repository.findWorkspaceContext).not.toHaveBeenCalled();
    expect(repository.findConfirmedUniversityRecipients).not.toHaveBeenCalled();
  });

  it('returns a prior decision without its private reason and does not let it override automatic results', async () => {
    const repository = eligibilityRepository();
    repository.findApplicationForManagerVerification.mockResolvedValueOnce(
      verificationApplication({
        eligibilityVerification: {
          decision: 'APPROVED',
          reason: 'private staff note',
          verificationBasisHash: 'stale-basis',
          decidedAt: new Date('2026-09-01T00:00:00.000Z'),
        },
      }) as never,
    );
    repository.findConfirmedUniversityRecipients.mockResolvedValue([
      { studentCode: '000123', fullName: 'Nguyễn Văn A', className: '24CTT1' },
    ]);
    const service = new CitySubmissionEligibilityService(repository as never);

    const result = await service.getManagerVerificationDetail(cityManager, 'application-a');

    expect(result.autoStatus).toBe('ELIGIBLE');
    expect(result.effectiveStatus).toBe('ELIGIBLE');
    expect(result.existingDecision).toEqual({
      decision: 'APPROVED',
      decidedAt: '2026-09-01T00:00:00.000Z',
    });
    expect(result.candidates).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('verificationBasisHash');
    expect(JSON.stringify(result)).not.toContain('private staff note');
  });
});

describe('pending eligibility verification manager list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.application.findMany.mockResolvedValue([
      { ...verificationApplication(), id: 'pending-a' },
      { ...verificationApplication(), id: 'resolved' },
      { ...verificationApplication(), id: 'auto-eligible' },
    ]);
  });

  it('requires City Manager before database access when using the pending filter', async () => {
    const service = new ManagerService(undefined, {} as never);

    await expect(
      service.listApplications({ ...cityManager, role: Role.admin }, {
        page: 1,
        limit: 20,
        eligibilityVerification: 'pending',
      } as never),
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect(prismaMock.application.findMany).not.toHaveBeenCalled();
  });

  it('filters automatic and effective pending cases before pagination across active schools', async () => {
    const eligibility = {
      getManagerVerificationStatus: vi.fn(
        async (_user: AuthenticatedUser, application: { id: string }) => {
          if (application.id === 'pending-a') {
            return {
              autoStatus: 'NEEDS_VERIFICATION',
              effectiveStatus: 'NEEDS_VERIFICATION',
              reasons: ['IDENTITY_MATCH_REQUIRES_VERIFICATION'],
            };
          }
          if (application.id === 'resolved') {
            return {
              autoStatus: 'NEEDS_VERIFICATION',
              effectiveStatus: 'ELIGIBLE',
              reasons: ['MANUAL_VERIFICATION_APPROVED'],
            };
          }
          return { autoStatus: 'ELIGIBLE', effectiveStatus: 'ELIGIBLE', reasons: [] };
        },
      ),
    };
    const service = new ManagerService(undefined, eligibility as never);

    const result = await service.listApplications(cityManager, {
      page: 1,
      limit: 1,
      eligibilityVerification: 'pending',
    } as never);

    expect(prismaMock.application.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          applicationType: ApplicationType.individual,
          targetLevel: Level.city,
          submittedAt: null,
          workspace: { is: { type: WorkspaceType.SCHOOL, isActive: true } },
        }),
        select: expect.objectContaining({
          student: expect.any(Object),
          workspace: expect.any(Object),
        }),
      }),
    );
    expect(eligibility.getManagerVerificationStatus).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      items: [
        {
          id: 'pending-a',
          schoolYear: '2025-2026',
          student: { fullName: 'Nguyễn Văn A', studentCode: '000123', className: '24CTT1' },
          school: { code: 'SCHOOL_A', name: 'Trường A' },
          autoStatus: 'NEEDS_VERIFICATION',
          effectiveStatus: 'NEEDS_VERIFICATION',
          reasons: ['IDENTITY_MATCH_REQUIRES_VERIFICATION'],
        },
      ],
      pagination: { page: 1, limit: 1, total: 1, totalPages: 1 },
    });
  });

  it('skips applications whose workspace hierarchy cannot be evaluated', async () => {
    prismaMock.application.findMany.mockResolvedValueOnce([
      { ...verificationApplication(), id: 'pending-a' },
      { ...verificationApplication(), id: 'unsupported-school' },
    ]);
    const eligibility = {
      getManagerVerificationStatus: vi.fn(
        async (_user: AuthenticatedUser, application: { id: string }) => {
          if (application.id === 'unsupported-school') {
            throw new AppError(
              409,
              ErrorCodes.UNSUPPORTED_WORKSPACE_HIERARCHY,
              'Unsupported school hierarchy',
            );
          }
          return {
            autoStatus: 'NEEDS_VERIFICATION',
            effectiveStatus: 'NEEDS_VERIFICATION',
            reasons: ['IDENTITY_MATCH_REQUIRES_VERIFICATION'],
          };
        },
      ),
    };
    const service = new ManagerService(undefined, eligibility as never);

    const result = await service.listApplications(cityManager, {
      page: 1,
      limit: 20,
      eligibilityVerification: 'pending',
    } as never);

    expect(result.items.map(({ id }) => id)).toEqual(['pending-a']);
    expect(result.pagination.total).toBe(1);
  });

  it('evaluates pending candidates in bounded batches before pagination', async () => {
    const applications = Array.from({ length: 23 }, (_, index) => ({
      ...verificationApplication(),
      id: `pending-${String(index).padStart(2, '0')}`,
    }));
    prismaMock.application.findMany.mockImplementation(({ where, skip = 0, take = 20 }) => {
      const cursor = where.id?.gt;
      const start = cursor ? Number(cursor.replace('pending-', '')) + 1 : skip;
      return Promise.resolve(applications.slice(start, start + take));
    });
    const eligibility = {
      getManagerVerificationStatus: vi.fn(async () => ({
        autoStatus: 'NEEDS_VERIFICATION',
        effectiveStatus: 'NEEDS_VERIFICATION',
        reasons: ['IDENTITY_MATCH_REQUIRES_VERIFICATION'],
      })),
    };
    const service = new ManagerService(undefined, eligibility as never);

    const result = await service.listApplications(cityManager, {
      page: 2,
      limit: 1,
      eligibilityVerification: 'pending',
    } as never);

    expect(prismaMock.application.findMany).toHaveBeenCalledTimes(2);
    expect(prismaMock.application.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ orderBy: [{ id: 'asc' }], take: 20 }),
    );
    expect(prismaMock.application.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ id: { gt: 'pending-19' } }),
        orderBy: [{ id: 'asc' }],
        take: 20,
      }),
    );
    expect(eligibility.getManagerVerificationStatus).toHaveBeenCalledTimes(23);
    expect(result.items.map(({ id }) => id)).toEqual(['pending-01']);
    expect(result.pagination.total).toBe(23);
  });
});

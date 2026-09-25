import { Role, WorkspaceType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../src/shared/types/auth';
import { CitySubmissionEligibilityService } from '../../src/modules/applications/city-submission-eligibility.service';

const schoolWorkspaceId = 'school-a';
const universityWorkspaceId = 'udn';

function user(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'student-a',
    workspaceId: schoolWorkspaceId,
    email: 'student-a@example.test',
    role: Role.student,
    fullName: 'Student A',
    studentCode: '000123',
    className: null,
    faculty: null,
    avatarUrl: null,
    workspace: {
      id: schoolWorkspaceId,
      code: 'SCHOOL_A',
      type: WorkspaceType.SCHOOL,
      name: 'School A',
      shortName: 'A',
    },
    ...overrides,
  };
}

function createRepository() {
  return {
    findApplication: vi.fn().mockResolvedValue({
      id: 'application-a',
      studentId: 'student-a',
      workspaceId: schoolWorkspaceId,
      schoolYear: '2025-2026',
      targetLevel: 'school',
    }),
    findWorkspaceContext: vi.fn().mockResolvedValue({
      id: schoolWorkspaceId,
      type: WorkspaceType.SCHOOL,
      parentWorkspaceId: universityWorkspaceId,
      parentWorkspace: { id: universityWorkspaceId, type: WorkspaceType.UNIVERSITY_SYSTEM },
    }),
    hasConfirmedAward: vi.fn().mockResolvedValue(true),
  };
}

describe('CitySubmissionEligibilityService', () => {
  let repository: ReturnType<typeof createRepository>;
  let service: CitySubmissionEligibilityService;

  beforeEach(() => {
    repository = createRepository();
    service = new CitySubmissionEligibilityService(repository as never);
  });

  it('requires confirmed school and UDN awards for a UDN student', async () => {
    const result = await service.getEligibility(user(), 'application-a');

    expect(result).toEqual({
      applicationId: 'application-a',
      schoolYear: '2025-2026',
      route: 'UDN_PREREQUISITE',
      eligible: true,
      schoolAward: { required: true, satisfied: true },
      universityAward: { required: true, satisfied: true },
      blockingReasons: [],
    });
    expect(repository.hasConfirmedAward).toHaveBeenNthCalledWith(1, {
      awardLevel: 'SCHOOL',
      issuerWorkspaceId: schoolWorkspaceId,
      institutionWorkspaceId: schoolWorkspaceId,
      studentCode: '000123',
      schoolYear: '2025-2026',
    });
    expect(repository.hasConfirmedAward).toHaveBeenNthCalledWith(2, {
      awardLevel: 'UNIVERSITY_SYSTEM',
      issuerWorkspaceId: universityWorkspaceId,
      institutionWorkspaceId: schoolWorkspaceId,
      studentCode: '000123',
      schoolYear: '2025-2026',
    });
  });

  it.each([
    [false, true, ['MISSING_SCHOOL_AWARD']],
    [true, false, ['MISSING_UNIVERSITY_SYSTEM_AWARD']],
    [false, false, ['MISSING_SCHOOL_AWARD', 'MISSING_UNIVERSITY_SYSTEM_AWARD']],
  ])('reports UDN blockers when award existence is %s / %s', async (school, university, blockers) => {
    repository.hasConfirmedAward.mockImplementation(async ({ awardLevel }) =>
      awardLevel === 'SCHOOL' ? school : university,
    );

    const result = await service.getEligibility(user(), 'application-a');

    expect(result.eligible).toBe(false);
    expect(result.blockingReasons).toEqual(blockers);
    expect(result.schoolAward.satisfied).toBe(school);
    expect(result.universityAward.satisfied).toBe(university);
  });

  it('returns DIRECT_CITY without looking up awards when the school has no parent', async () => {
    repository.findWorkspaceContext.mockResolvedValue({
      id: schoolWorkspaceId,
      type: WorkspaceType.SCHOOL,
      parentWorkspaceId: null,
      parentWorkspace: null,
    });

    const result = await service.getEligibility(user(), 'application-a');

    expect(result).toEqual({
      applicationId: 'application-a',
      schoolYear: '2025-2026',
      route: 'DIRECT_CITY',
      eligible: true,
      schoolAward: { required: false, satisfied: true },
      universityAward: { required: false, satisfied: true },
      blockingReasons: [],
    });
    expect(repository.hasConfirmedAward).not.toHaveBeenCalled();
  });

  it('does not query awards when a UDN student has no canonical student code', async () => {
    const result = await service.getEligibility(user({ studentCode: null }), 'application-a');

    expect(result.eligible).toBe(false);
    expect(result.blockingReasons).toEqual(['MISSING_STUDENT_CODE']);
    expect(repository.hasConfirmedAward).not.toHaveBeenCalled();
  });

  it('does not require a student code for the DIRECT_CITY prerequisite route', async () => {
    repository.findWorkspaceContext.mockResolvedValue({
      id: schoolWorkspaceId,
      type: WorkspaceType.SCHOOL,
      parentWorkspaceId: null,
      parentWorkspace: null,
    });

    const result = await service.getEligibility(user({ studentCode: null }), 'application-a');

    expect(result.eligible).toBe(true);
    expect(result.blockingReasons).toEqual([]);
  });

  it('authorizes the application owner before looking up workspace or awards', async () => {
    repository.findApplication.mockResolvedValue({
      id: 'application-b',
      studentId: 'student-b',
      workspaceId: schoolWorkspaceId,
      schoolYear: '2025-2026',
      targetLevel: 'city',
    });

    await expect(
      service.getEligibility(user(), 'application-b'),
    ).rejects.toMatchObject({ statusCode: 403, code: 'APPLICATION_OWNER_REQUIRED' });
    expect(repository.findWorkspaceContext).not.toHaveBeenCalled();
    expect(repository.hasConfirmedAward).not.toHaveBeenCalled();
  });

  it('hides applications from another workspace before eligibility lookups', async () => {
    repository.findApplication.mockResolvedValue({
      id: 'application-b',
      studentId: 'student-b',
      workspaceId: 'school-b',
      schoolYear: '2025-2026',
      targetLevel: 'city',
    });

    await expect(service.getEligibility(user(), 'application-b')).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
    expect(repository.findWorkspaceContext).not.toHaveBeenCalled();
    expect(repository.hasConfirmedAward).not.toHaveBeenCalled();
  });

  it('rejects a student account outside a SCHOOL workspace', async () => {
    repository.findWorkspaceContext.mockResolvedValue({
      id: schoolWorkspaceId,
      type: WorkspaceType.CITY,
      parentWorkspaceId: null,
      parentWorkspace: null,
    });

    await expect(service.getEligibility(user(), 'application-a')).rejects.toMatchObject({
      statusCode: 409,
      code: 'INVALID_APPLICATION_CONTEXT',
    });
    expect(repository.hasConfirmedAward).not.toHaveBeenCalled();
  });

  it('rejects an unsupported immediate parent instead of treating it as DIRECT_CITY', async () => {
    repository.findWorkspaceContext.mockResolvedValue({
      id: schoolWorkspaceId,
      type: WorkspaceType.SCHOOL,
      parentWorkspaceId: 'other-parent',
      parentWorkspace: { id: 'other-parent', type: WorkspaceType.CITY },
    });

    await expect(service.getEligibility(user(), 'application-a')).rejects.toMatchObject({
      statusCode: 409,
      code: 'UNSUPPORTED_WORKSPACE_HIERARCHY',
    });
    expect(repository.hasConfirmedAward).not.toHaveBeenCalled();
  });
});

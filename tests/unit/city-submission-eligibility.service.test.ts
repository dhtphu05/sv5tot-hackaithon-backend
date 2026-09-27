import { Role, WorkspaceType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../src/shared/types/auth';
import { CitySubmissionEligibilityService } from '../../src/modules/applications/city-submission-eligibility.service';
import { UsersService } from '../../src/modules/users/users.service';

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
    className: '24CTT1',
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
  const state: { manualVerification: Record<string, unknown> | null } = {
    manualVerification: null,
  };
  return {
    state,
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
    findConfirmedUniversityRecipients: vi.fn().mockResolvedValue([
      { studentCode: '000123', fullName: 'Student A', className: '24CTT1' },
    ]),
    findManualVerification: vi.fn().mockImplementation(async () => state.manualVerification),
    findApplicationForVerification: vi.fn().mockResolvedValue({
      id: 'application-a',
      studentId: 'student-a',
      workspaceId: schoolWorkspaceId,
      schoolYear: '2025-2026',
      applicationType: 'individual',
      targetLevel: 'city',
      status: 'ready_to_submit',
      submittedAt: null,
      workspace: { type: WorkspaceType.SCHOOL, isActive: true },
    }),
    findStudentIdentity: vi.fn().mockResolvedValue({
      workspaceId: schoolWorkspaceId,
      studentCode: null,
      fullName: 'Student A',
      className: '24CTT1',
    }),
    saveVerification: vi.fn().mockImplementation(async (input) => {
      state.manualVerification = {
        decision: input.decision,
        verificationBasisHash: input.verificationBasisHash,
      };
      return { ...input, decidedAt: new Date('2026-09-01T00:00:00.000Z') };
    }),
  };
}

function cityManager(): AuthenticatedUser {
  const cityId = 'city-workspace';
  return user({
    id: 'city-manager',
    role: Role.city_manager,
    workspaceId: cityId,
    workspace: {
      id: cityId,
      code: 'DANANG_CITY',
      type: WorkspaceType.CITY,
      name: 'Da Nang',
      shortName: 'Da Nang',
    },
  });
}

describe('CitySubmissionEligibilityService', () => {
  let repository: ReturnType<typeof createRepository>;
  let service: CitySubmissionEligibilityService;

  beforeEach(() => {
    repository = createRepository();
    service = new CitySubmissionEligibilityService(repository as never);
  });

  it('accepts a confirmed UDN award without requiring a separate school award', async () => {
    const result = await service.getEligibility(user(), 'application-a');

    expect(result).toEqual({
      applicationId: 'application-a',
      schoolYear: '2025-2026',
      route: 'UDN_PREREQUISITE',
      status: 'ELIGIBLE',
      reasons: [],
    });
    expect(repository.findConfirmedUniversityRecipients).toHaveBeenCalledOnce();
    expect(repository.findConfirmedUniversityRecipients).toHaveBeenCalledWith({
      issuerWorkspaceId: universityWorkspaceId,
      institutionWorkspaceId: schoolWorkspaceId,
      schoolYear: '2025-2026',
    });
  });

  it('returns NOT_ELIGIBLE when only a school-level award exists', async () => {
    repository.findConfirmedUniversityRecipients.mockResolvedValue([]);

    const result = await service.getEligibility(user(), 'application-a');

    expect(result.status).toBe('NOT_ELIGIBLE');
    expect(result.reasons).toEqual(['MISSING_UNIVERSITY_SYSTEM_AWARD']);
  });

  it('returns NOT_ELIGIBLE when there are no qualifying awards', async () => {
    repository.findConfirmedUniversityRecipients.mockResolvedValue([]);

    const result = await service.getEligibility(user(), 'application-a');

    expect(result.status).toBe('NOT_ELIGIBLE');
    expect(result.reasons).toEqual(['MISSING_UNIVERSITY_SYSTEM_AWARD']);
  });

  it('returns DIRECT_CITY as eligible without looking up awards', async () => {
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
      status: 'ELIGIBLE',
      reasons: [],
    });
    expect(repository.findConfirmedUniversityRecipients).not.toHaveBeenCalled();
  });

  it('treats multiple exact-code UDN recipients as eligible', async () => {
    repository.findConfirmedUniversityRecipients.mockResolvedValue([
      { studentCode: '000123', fullName: 'Student A', className: '24CTT1' },
      { studentCode: '000123', fullName: 'Student A', className: '24CTT1' },
    ]);

    const result = await service.getEligibility(user(), 'application-a');

    expect(result.status).toBe('ELIGIBLE');
    expect(result.reasons).toEqual([]);
  });

  it('normalizes student codes without dropping leading zeros', async () => {
    repository.findConfirmedUniversityRecipients.mockResolvedValue([
      { studentCode: ' 000123 ', fullName: 'Student A', className: '24CTT1' },
    ]);

    const result = await service.getEligibility(user({ studentCode: ' 000123 ' }), 'application-a');

    expect(result.status).toBe('ELIGIBLE');
  });

  it('requires manual verification when name and class signal a match but student code is missing', async () => {
    const result = await service.getEligibility(user({ studentCode: null }), 'application-a');

    expect(result.status).toBe('NEEDS_VERIFICATION');
    expect(result.reasons).toEqual(['IDENTITY_MATCH_REQUIRES_VERIFICATION']);
  });

  it('does not use name and class to override a differing usable student code', async () => {
    repository.findConfirmedUniversityRecipients.mockResolvedValue([
      { studentCode: '999999', fullName: 'Student A', className: '24CTT1' },
    ]);

    const result = await service.getEligibility(user(), 'application-a');

    expect(result.status).toBe('NEEDS_VERIFICATION');
    expect(result.reasons).toEqual(['IDENTITY_MATCH_REQUIRES_VERIFICATION']);
  });

  it('does not treat a same-name recipient in a different class as an identity signal', async () => {
    repository.findConfirmedUniversityRecipients.mockResolvedValue([
      { studentCode: '999999', fullName: 'Student A', className: '24CTT2' },
    ]);

    const result = await service.getEligibility(user(), 'application-a');

    expect(result.status).toBe('NOT_ELIGIBLE');
    expect(result.reasons).toEqual(['MISSING_UNIVERSITY_SYSTEM_AWARD']);
  });

  it('requires manual verification when name and class match multiple recipients', async () => {
    repository.findConfirmedUniversityRecipients.mockResolvedValue([
      { studentCode: '999999', fullName: 'Student A', className: '24CTT1' },
      { studentCode: '888888', fullName: 'Student A', className: '24CTT1' },
    ]);

    const result = await service.getEligibility(user(), 'application-a');

    expect(result.status).toBe('NEEDS_VERIFICATION');
    expect(result.reasons).toEqual(['AMBIGUOUS_UNIVERSITY_SYSTEM_AWARD_MATCH']);
  });

  it('uses an approved manual verification only when automatic eligibility needs verification', async () => {
    await service.verifyEligibility(cityManager(), 'application-a', {
      decision: 'APPROVED',
      reason: 'Matched against the signed decision',
    });

    const result = await service.getEligibility(user({ studentCode: null }), 'application-a');

    expect(result.status).toBe('ELIGIBLE');
    expect(result.reasons).toEqual(['MANUAL_VERIFICATION_APPROVED']);
    expect(result).not.toHaveProperty('reason');
  });

  it('uses a rejected manual verification as NOT_ELIGIBLE only for an automatic verification signal', async () => {
    await service.verifyEligibility(cityManager(), 'application-a', {
      decision: 'REJECTED',
      reason: 'Identity could not be confirmed',
    });

    const result = await service.getEligibility(user({ studentCode: null }), 'application-a');

    expect(result.status).toBe('NOT_ELIGIBLE');
    expect(result.reasons).toEqual(['MANUAL_VERIFICATION_REJECTED']);
    expect(result).not.toHaveProperty('reason');
  });

  it('does not allow manual approval to override automatic NOT_ELIGIBLE', async () => {
    repository.findConfirmedUniversityRecipients.mockResolvedValue([]);
    repository.state.manualVerification = {
      decision: 'APPROVED',
      verificationBasisHash: 'old-basis',
    };

    const result = await service.getEligibility(user(), 'application-a');

    expect(result.status).toBe('NOT_ELIGIBLE');
    expect(result.reasons).toEqual(['MISSING_UNIVERSITY_SYSTEM_AWARD']);
  });

  it('invalidates an approval after the student changes an identity field through /api/me', async () => {
    let identity = {
      workspaceId: schoolWorkspaceId,
      studentCode: null,
      fullName: 'Student A',
      className: '24CTT1',
    };
    repository.findStudentIdentity.mockImplementation(async () => identity);
    repository.findConfirmedUniversityRecipients.mockResolvedValue([
      { studentCode: '111111', fullName: 'Student A', className: '24CTT1' },
      { studentCode: '222222', fullName: 'Student B', className: '24CTT1' },
    ]);
    const applicant = user({ studentCode: null });

    expect((await service.getEligibility(applicant, 'application-a')).status).toBe(
      'NEEDS_VERIFICATION',
    );
    await service.verifyEligibility(cityManager(), 'application-a', {
      decision: 'APPROVED',
      reason: 'Checked the official signed decision.',
    });
    expect((await service.getEligibility(applicant, 'application-a')).status).toBe('ELIGIBLE');

    let persistedUser = {
      ...applicant,
      phone: null,
      isActive: true,
      lastLoginAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    };
    const usersRepository = {
      updateById: vi.fn(async (_id: string, input: { fullName?: string }) => {
        persistedUser = { ...persistedUser, ...input };
        identity = { ...identity, fullName: persistedUser.fullName };
        return persistedUser;
      }),
    };
    const usersService = new UsersService(usersRepository as never);
    const updated = await usersService.updateMe(applicant.id, { fullName: 'Student B' });
    const reloadedApplicant = user({
      studentCode: null,
      fullName: updated.fullName,
    });

    expect(usersRepository.updateById).toHaveBeenCalledWith(applicant.id, {
      fullName: 'Student B',
    });
    expect((await service.getEligibility(reloadedApplicant, 'application-a')).status).toBe(
      'NEEDS_VERIFICATION',
    );
  });

  it('keeps verification valid after an unrelated profile field changes', async () => {
    await service.verifyEligibility(cityManager(), 'application-a', {
      decision: 'APPROVED',
      reason: 'Checked the official signed decision.',
    });
    const applicant = user({ studentCode: null });
    const usersRepository = {
      updateById: vi.fn(async (_id: string, input: { phone?: string | null }) => ({
        ...applicant,
        phone: input.phone ?? null,
        isActive: true,
        lastLoginAt: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      })),
    };
    const usersService = new UsersService(usersRepository as never);

    await usersService.updateMe(applicant.id, { phone: '+84901234567' });

    expect((await service.getEligibility(applicant, 'application-a')).status).toBe('ELIGIBLE');
  });

  it('allows a manager to replace a stale decision for the new identity basis', async () => {
    let identity = {
      workspaceId: schoolWorkspaceId,
      studentCode: null,
      fullName: 'Student A',
      className: '24CTT1',
    };
    repository.findStudentIdentity.mockImplementation(async () => identity);
    repository.findConfirmedUniversityRecipients.mockResolvedValue([
      { studentCode: '111111', fullName: 'Student A', className: '24CTT1' },
      { studentCode: '222222', fullName: 'Student B', className: '24CTT1' },
    ]);
    const applicant = user({ studentCode: null });
    await service.verifyEligibility(cityManager(), 'application-a', {
      decision: 'APPROVED',
      reason: 'Checked the first identity.',
    });

    const usersService = new UsersService({
      updateById: vi.fn(async (_id: string, input: { fullName?: string }) => {
        identity = { ...identity, fullName: input.fullName ?? identity.fullName };
        return {
          ...applicant,
          fullName: identity.fullName,
          phone: null,
          isActive: true,
          lastLoginAt: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-09-02T00:00:00.000Z'),
        };
      }),
    } as never);
    await usersService.updateMe(applicant.id, { fullName: 'Student B' });
    const reloadedApplicant = user({ studentCode: null, fullName: 'Student B' });

    expect((await service.getEligibility(reloadedApplicant, 'application-a')).status).toBe(
      'NEEDS_VERIFICATION',
    );
    await service.verifyEligibility(cityManager(), 'application-a', {
      decision: 'APPROVED',
      reason: 'Checked the updated identity.',
    });

    expect((await service.getEligibility(reloadedApplicant, 'application-a')).status).toBe(
      'ELIGIBLE',
    );
    expect(repository.saveVerification).toHaveBeenCalledTimes(2);
  });

  it('lets a definitive automatic ELIGIBLE result win over a stored manual decision', async () => {
    repository.state.manualVerification = {
      decision: 'REJECTED',
      verificationBasisHash: 'old-basis',
    };

    const result = await service.getEligibility(user(), 'application-a');

    expect(result.status).toBe('ELIGIBLE');
    expect(result.reasons).toEqual([]);
    expect(repository.findManualVerification).not.toHaveBeenCalled();
  });

  it.each(['APPROVED', 'REJECTED'] as const)(
    'lets a City Manager record %s only for a City individual application requiring verification',
    async (decision) => {
      const result = await service.verifyEligibility(cityManager(), 'application-a', {
        decision,
        reason: 'Checked the official signed decision.',
      });

      expect(result.decision).toBe(decision);
      expect(repository.findApplicationForVerification).toHaveBeenCalledWith('application-a');
      expect(repository.findStudentIdentity).toHaveBeenCalledWith('student-a');
      expect(repository.saveVerification).toHaveBeenCalledWith({
        applicationId: 'application-a',
        decision,
        reason: 'Checked the official signed decision.',
        verificationBasisHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        actorId: 'city-manager',
        actorRole: Role.city_manager,
      });
    },
  );

  it.each([
    [
      'ELIGIBLE',
      [{ studentCode: '000123', fullName: 'Student A', className: '24CTT1' }],
      { workspaceId: schoolWorkspaceId, studentCode: '000123', fullName: 'Student A', className: '24CTT1' },
    ],
    [
      'NOT_ELIGIBLE',
      [],
      { workspaceId: schoolWorkspaceId, studentCode: null, fullName: 'Student A', className: '24CTT1' },
    ],
  ] as const)(
    'rejects manual verification when automatic status is %s',
    async (_status, recipients, identity) => {
      repository.findConfirmedUniversityRecipients.mockResolvedValue([...recipients]);
      repository.findStudentIdentity.mockResolvedValue(identity);

      await expect(
        service.verifyEligibility(cityManager(), 'application-a', {
          decision: 'APPROVED',
          reason: 'Checked the official signed decision.',
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'ELIGIBILITY_VERIFICATION_NOT_REQUIRED',
      });
      expect(repository.saveVerification).not.toHaveBeenCalled();
    },
  );

  it('does not permit a City Manager to verify an already submitted application', async () => {
    repository.findApplicationForVerification.mockResolvedValue({
      id: 'application-a',
      studentId: 'student-a',
      workspaceId: 'school-b',
      schoolYear: '2025-2026',
      applicationType: 'individual',
      targetLevel: 'city',
      status: 'under_review',
      submittedAt: new Date('2026-09-01T00:00:00.000Z'),
      workspace: { type: WorkspaceType.SCHOOL, isActive: true },
    });

    await expect(
      service.verifyEligibility(cityManager(), 'application-a', {
        decision: 'APPROVED',
        reason: 'Checked the official signed decision.',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(repository.saveVerification).not.toHaveBeenCalled();
  });

  it('permits pre-submit verification when a never-submitted application was marked supplement_required', async () => {
    repository.findApplicationForVerification.mockResolvedValue({
      id: 'application-a',
      studentId: 'student-a',
      workspaceId: schoolWorkspaceId,
      schoolYear: '2025-2026',
      applicationType: 'individual',
      targetLevel: 'city',
      status: 'supplement_required',
      submittedAt: null,
      workspace: { type: WorkspaceType.SCHOOL, isActive: true },
    });

    await service.verifyEligibility(cityManager(), 'application-a', {
      decision: 'APPROVED',
      reason: 'Checked the official signed decision.',
    });

    expect(repository.saveVerification).toHaveBeenCalledOnce();
  });

  it('reports missing identity context when code and name/class cannot identify a recipient', async () => {
    const result = await service.getEligibility(
      user({ studentCode: null, fullName: ' ', className: null }),
      'application-a',
    );

    expect(result.status).toBe('NOT_ELIGIBLE');
    expect(result.reasons).toEqual(['MISSING_IDENTITY_CONTEXT']);
  });

  it('authorizes the application owner before looking up workspace or awards', async () => {
    repository.findApplication.mockResolvedValue({
      id: 'application-b',
      studentId: 'student-b',
      workspaceId: schoolWorkspaceId,
      schoolYear: '2025-2026',
      targetLevel: 'city',
    });

    await expect(service.getEligibility(user(), 'application-b')).rejects.toMatchObject({
      statusCode: 403,
      code: 'APPLICATION_OWNER_REQUIRED',
    });
    expect(repository.findWorkspaceContext).not.toHaveBeenCalled();
    expect(repository.findConfirmedUniversityRecipients).not.toHaveBeenCalled();
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
    expect(repository.findConfirmedUniversityRecipients).not.toHaveBeenCalled();
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
    expect(repository.findConfirmedUniversityRecipients).not.toHaveBeenCalled();
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
    expect(repository.findConfirmedUniversityRecipients).not.toHaveBeenCalled();
  });
});

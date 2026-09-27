import { Role, WorkspaceType } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '../../src/shared/types/auth';
import {
  assertCriteriaCompletionStaffAccess,
  assertCriteriaCompletionViewAccess,
} from '../../src/modules/criteria-completion/criteria-completion.service';

const schoolApplication = {
  id: 'application-1',
  workspaceId: 'school-a',
  studentId: 'student-1',
  workspace: { type: WorkspaceType.SCHOOL, isActive: true },
  student: { faculty: 'Engineering' },
};

function user(role: Role, workspaceId: string, workspaceType: WorkspaceType): AuthenticatedUser {
  return {
    id: 'staff-1',
    workspaceId,
    email: 'staff@example.test',
    role,
    fullName: 'Staff',
    studentCode: null,
    className: null,
    faculty: null,
    avatarUrl: null,
    workspace: {
      id: workspaceId,
      code: workspaceId,
      type: workspaceType,
      name: workspaceId,
      shortName: null,
    },
  };
}

describe('criteria completion City workspace access', () => {
  it('allows City Manager to read and confirm data on an active School application', () => {
    const cityManager = user(Role.city_manager, 'danang-city', WorkspaceType.CITY);

    expect(() => assertCriteriaCompletionViewAccess(schoolApplication, cityManager)).not.toThrow();
    expect(() => assertCriteriaCompletionStaffAccess(schoolApplication, cityManager)).not.toThrow();
  });

  it('allows City Committee to read but not mutate criteria completion', () => {
    const committee = user(Role.city_committee, 'danang-city', WorkspaceType.CITY);

    expect(() => assertCriteriaCompletionViewAccess(schoolApplication, committee)).not.toThrow();
    expect(() => assertCriteriaCompletionStaffAccess(schoolApplication, committee)).toThrow();
  });

  it('rejects City access to inactive Schools and same-workspace access from legacy managers', () => {
    const cityManager = user(Role.city_manager, 'danang-city', WorkspaceType.CITY);
    const legacyManager = user(Role.manager, 'school-b', WorkspaceType.SCHOOL);

    expect(() =>
      assertCriteriaCompletionViewAccess(
        { ...schoolApplication, workspace: { type: WorkspaceType.SCHOOL, isActive: false } },
        cityManager,
      ),
    ).toThrow();
    expect(() => assertCriteriaCompletionViewAccess(schoolApplication, legacyManager)).toThrow();
  });

  it('does not let a City Officer use application-level completion access', () => {
    const cityOfficer = user(Role.city_officer, 'danang-city', WorkspaceType.CITY);

    expect(() => assertCriteriaCompletionViewAccess(schoolApplication, cityOfficer)).toThrow();
    expect(() => assertCriteriaCompletionStaffAccess(schoolApplication, cityOfficer)).toThrow();
  });
});

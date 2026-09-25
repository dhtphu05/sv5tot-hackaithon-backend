import { AwardLevel, WorkspaceType, type Application } from '@prisma/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { assertSameWorkspace, requireUserWorkspace } from '../../shared/utils/workspace-scope';
import { assertApplicationOwner } from './application.helpers';
import { CitySubmissionEligibilityRepository } from './city-submission-eligibility.repository';

type EligibilityApplication = Pick<Application, 'id' | 'studentId' | 'workspaceId' | 'schoolYear'>;

type WorkspaceContext = {
  id: string;
  type: WorkspaceType;
  parentWorkspaceId: string | null;
  parentWorkspace: { id: string; type: WorkspaceType } | null;
};

export type CitySubmissionEligibility = {
  applicationId: string;
  schoolYear: string;
  route: 'UDN_PREREQUISITE' | 'DIRECT_CITY';
  eligible: boolean;
  schoolAward: { required: boolean; satisfied: boolean };
  universityAward: { required: boolean; satisfied: boolean };
  blockingReasons: Array<
    'MISSING_STUDENT_CODE' | 'MISSING_SCHOOL_AWARD' | 'MISSING_UNIVERSITY_SYSTEM_AWARD'
  >;
};

export class CitySubmissionEligibilityService {
  constructor(
    private readonly repository = new CitySubmissionEligibilityRepository(),
  ) {}

  async getEligibility(
    user: AuthenticatedUser,
    applicationId: string,
  ): Promise<CitySubmissionEligibility> {
    const application = await this.repository.findApplication(applicationId);
    if (!application) {
      throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
    }

    assertSameWorkspace(user, application, 'Application not found');
    assertApplicationOwner(application, user);

    const workspaceId = requireUserWorkspace(user);
    const workspace = await this.repository.findWorkspaceContext(workspaceId);
    if (!workspace || workspace.type !== WorkspaceType.SCHOOL) {
      throw new AppError(
        409,
        ErrorCodes.INVALID_APPLICATION_CONTEXT,
        'City submission eligibility requires a student in a school workspace',
      );
    }

    if (workspace.parentWorkspaceId === null) {
      return directCityResult(application);
    }

    if (
      workspace.parentWorkspace?.id !== workspace.parentWorkspaceId ||
      workspace.parentWorkspace.type !== WorkspaceType.UNIVERSITY_SYSTEM
    ) {
      throw new AppError(
        409,
        ErrorCodes.UNSUPPORTED_WORKSPACE_HIERARCHY,
        'School workspace has an unsupported parent workspace',
      );
    }

    return this.getUdnEligibility(user, application, workspace, workspace.parentWorkspace.id);
  }

  private async getUdnEligibility(
    user: AuthenticatedUser,
    application: EligibilityApplication,
    school: WorkspaceContext,
    universityWorkspaceId: string,
  ): Promise<CitySubmissionEligibility> {
    if (user.studentCode === null || user.studentCode.length === 0) {
      return {
        applicationId: application.id,
        schoolYear: application.schoolYear,
        route: 'UDN_PREREQUISITE',
        eligible: false,
        schoolAward: { required: true, satisfied: false },
        universityAward: { required: true, satisfied: false },
        blockingReasons: ['MISSING_STUDENT_CODE'],
      };
    }

    const sharedLookup = {
      institutionWorkspaceId: school.id,
      studentCode: user.studentCode,
      schoolYear: application.schoolYear,
    };
    const [hasSchoolAward, hasUniversityAward] = await Promise.all([
      this.repository.hasConfirmedAward({
        ...sharedLookup,
        awardLevel: AwardLevel.SCHOOL,
        issuerWorkspaceId: school.id,
      }),
      this.repository.hasConfirmedAward({
        ...sharedLookup,
        awardLevel: AwardLevel.UNIVERSITY_SYSTEM,
        issuerWorkspaceId: universityWorkspaceId,
      }),
    ]);

    const blockingReasons: CitySubmissionEligibility['blockingReasons'] = [];
    if (!hasSchoolAward) blockingReasons.push('MISSING_SCHOOL_AWARD');
    if (!hasUniversityAward) blockingReasons.push('MISSING_UNIVERSITY_SYSTEM_AWARD');

    return {
      applicationId: application.id,
      schoolYear: application.schoolYear,
      route: 'UDN_PREREQUISITE',
      eligible: blockingReasons.length === 0,
      schoolAward: { required: true, satisfied: hasSchoolAward },
      universityAward: { required: true, satisfied: hasUniversityAward },
      blockingReasons,
    };
  }
}

function directCityResult(application: EligibilityApplication): CitySubmissionEligibility {
  return {
    applicationId: application.id,
    schoolYear: application.schoolYear,
    route: 'DIRECT_CITY',
    eligible: true,
    schoolAward: { required: false, satisfied: true },
    universityAward: { required: false, satisfied: true },
    blockingReasons: [],
  };
}

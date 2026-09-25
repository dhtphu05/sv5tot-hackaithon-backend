import { WorkspaceType, type Application } from '@prisma/client';
import { normalizeText } from '../decision-imports/decision-ocr-table-normalizer';
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
  status: 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'NEEDS_VERIFICATION';
  reasons: Array<
    | 'MISSING_UNIVERSITY_SYSTEM_AWARD'
    | 'MISSING_IDENTITY_CONTEXT'
    | 'IDENTITY_MATCH_REQUIRES_VERIFICATION'
    | 'AMBIGUOUS_UNIVERSITY_SYSTEM_AWARD_MATCH'
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
    const recipients = await this.repository.findConfirmedUniversityRecipients({
      issuerWorkspaceId: universityWorkspaceId,
      institutionWorkspaceId: school.id,
      schoolYear: application.schoolYear,
    });

    const studentCode = normalizeStudentCode(user.studentCode);
    if (
      studentCode &&
      recipients.some((recipient) => normalizeStudentCode(recipient.studentCode) === studentCode)
    ) {
      return udnResult(application, 'ELIGIBLE', []);
    }

    const fullName = normalizeText(user.fullName);
    const className = normalizeText(user.className ?? '');
    const identityMatches = fullName && className
      ? recipients.filter(
          (recipient) =>
            normalizeText(recipient.fullName) === fullName &&
            normalizeText(recipient.className ?? '') === className,
        )
      : [];

    if (identityMatches.length > 1) {
      return udnResult(application, 'NEEDS_VERIFICATION', [
        'AMBIGUOUS_UNIVERSITY_SYSTEM_AWARD_MATCH',
      ]);
    }

    if (identityMatches.length === 1) {
      return udnResult(application, 'NEEDS_VERIFICATION', [
        'IDENTITY_MATCH_REQUIRES_VERIFICATION',
      ]);
    }

    if (!studentCode && (!fullName || !className)) {
      return udnResult(application, 'NOT_ELIGIBLE', ['MISSING_IDENTITY_CONTEXT']);
    }

    const reasons: CitySubmissionEligibility['reasons'] = ['MISSING_UNIVERSITY_SYSTEM_AWARD'];
    if (!fullName || !className) reasons.push('MISSING_IDENTITY_CONTEXT');
    return udnResult(application, 'NOT_ELIGIBLE', reasons);
  }
}

function directCityResult(application: EligibilityApplication): CitySubmissionEligibility {
  return {
    applicationId: application.id,
    schoolYear: application.schoolYear,
    route: 'DIRECT_CITY',
    status: 'ELIGIBLE',
    reasons: [],
  };
}

function udnResult(
  application: EligibilityApplication,
  status: CitySubmissionEligibility['status'],
  reasons: CitySubmissionEligibility['reasons'],
): CitySubmissionEligibility {
  return {
    applicationId: application.id,
    schoolYear: application.schoolYear,
    route: 'UDN_PREREQUISITE',
    status,
    reasons,
  };
}

function normalizeStudentCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase() ?? '';
  return normalized || null;
}

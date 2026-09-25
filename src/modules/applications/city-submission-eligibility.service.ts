import { createHash } from 'node:crypto';
import {
  ApplicationEligibilityVerificationDecision,
  ApplicationStatus,
  ApplicationType,
  Level,
  Role,
  WorkspaceType,
  type Application,
} from '@prisma/client';
import { normalizeText } from '../decision-imports/decision-ocr-table-normalizer';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { assertSameWorkspace, requireUserWorkspace } from '../../shared/utils/workspace-scope';
import { assertApplicationOwner } from './application.helpers';
import { assertReviewWorkspaceAccess } from '../../shared/utils/review-workspace-scope';
import {
  CitySubmissionEligibilityRepository,
  type SaveEligibilityVerificationInput,
} from './city-submission-eligibility.repository';

type EligibilityApplication = Pick<Application, 'id' | 'studentId' | 'workspaceId' | 'schoolYear'>;
type EligibilityIdentity = Pick<AuthenticatedUser, 'studentCode' | 'fullName' | 'className'>;
type VerificationApplication = {
  id: string;
  studentId: string;
  workspaceId: string;
  schoolYear: string;
  applicationType: ApplicationType;
  targetLevel: Level;
  status: ApplicationStatus;
  submittedAt: Date | null;
  workspace: { type: WorkspaceType; isActive: boolean };
};

type WorkspaceContext = {
  id: string;
  type: WorkspaceType;
  parentWorkspaceId: string | null;
  parentWorkspace: { id: string; type: WorkspaceType } | null;
};

type EligibilityCalculation = {
  result: CitySubmissionEligibility;
  verificationBasisHash: string | null;
};

type VerificationBasisRecipient = {
  studentCode: string;
  fullName: string;
  className: string | null;
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
    | 'MANUAL_VERIFICATION_APPROVED'
    | 'MANUAL_VERIFICATION_REJECTED'
  >;
};

export type EligibilityVerificationInput = {
  decision: ApplicationEligibilityVerificationDecision;
  reason: string;
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

    const automatic = await this.calculateAutomaticEligibility(
      application,
      user,
      requireUserWorkspace(user),
    );

    if (automatic.result.status !== 'NEEDS_VERIFICATION') return automatic.result;

    const verification = await this.repository.findManualVerification(application.id);
    if (
      !verification ||
      !automatic.verificationBasisHash ||
      verification.verificationBasisHash !== automatic.verificationBasisHash
    ) {
      return automatic.result;
    }

    return {
      ...automatic.result,
      status: verification.decision === ApplicationEligibilityVerificationDecision.APPROVED
        ? 'ELIGIBLE'
        : 'NOT_ELIGIBLE',
      reasons: [
        verification.decision === ApplicationEligibilityVerificationDecision.APPROVED
          ? 'MANUAL_VERIFICATION_APPROVED'
          : 'MANUAL_VERIFICATION_REJECTED',
      ],
    };
  }

  async verifyEligibility(
    user: AuthenticatedUser,
    applicationId: string,
    input: EligibilityVerificationInput,
  ) {
    if (user.role !== Role.city_manager) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Only a City Manager can verify eligibility');
    }

    const application = (await this.repository.findApplicationForVerification(
      applicationId,
    )) as VerificationApplication | null;
    if (!application) {
      throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
    }

    assertReviewWorkspaceAccess(
      user,
      {
        workspaceId: application.workspaceId,
        workspaceType: application.workspace?.type,
        workspaceIsActive: application.workspace?.isActive,
      },
      'Application not found',
    );

    if (
      application.applicationType !== ApplicationType.individual ||
      application.targetLevel !== Level.city
    ) {
      throw new AppError(404, ErrorCodes.NOT_FOUND, 'City application not found');
    }

    if (
      application.submittedAt !== null ||
      (application.status !== ApplicationStatus.draft &&
        application.status !== ApplicationStatus.prechecked &&
        application.status !== ApplicationStatus.ready_to_submit &&
        application.status !== ApplicationStatus.supplement_required)
    ) {
      throw new AppError(
        409,
        ErrorCodes.APPLICATION_LOCKED,
        'Eligibility can only be verified before the initial submission',
      );
    }

    if (!input.reason.trim()) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'Verification reason is required');
    }

    const identity = await this.repository.findStudentIdentity(application.studentId);
    if (!identity || identity.workspaceId !== application.workspaceId) {
      throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
    }

    const automatic = await this.calculateAutomaticEligibility(
      application,
      identity,
      application.workspaceId,
    );
    if (automatic.result.status !== 'NEEDS_VERIFICATION') {
      throw new AppError(
        409,
        ErrorCodes.ELIGIBILITY_VERIFICATION_NOT_REQUIRED,
        'Manual verification is available only when automatic eligibility needs verification',
        { status: automatic.result.status },
      );
    }

    if (!automatic.verificationBasisHash) {
      throw new AppError(
        409,
        ErrorCodes.ELIGIBILITY_VERIFICATION_NOT_REQUIRED,
        'Manual verification requires a current eligibility basis',
      );
    }

    const saveInput: SaveEligibilityVerificationInput = {
      applicationId: application.id,
      decision: input.decision,
      reason: input.reason.trim(),
      verificationBasisHash: automatic.verificationBasisHash,
      actorId: user.id,
      actorRole: user.role,
    };
    return this.repository.saveVerification(saveInput);
  }

  private async calculateAutomaticEligibility(
    application: EligibilityApplication,
    identity: EligibilityIdentity,
    workspaceId: string,
  ): Promise<EligibilityCalculation> {
    const workspace = await this.repository.findWorkspaceContext(workspaceId);
    if (!workspace || workspace.type !== WorkspaceType.SCHOOL) {
      throw new AppError(
        409,
        ErrorCodes.INVALID_APPLICATION_CONTEXT,
        'City submission eligibility requires a student in a school workspace',
      );
    }

    if (workspace.parentWorkspaceId === null) {
      return { result: directCityResult(application), verificationBasisHash: null };
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

    return this.getUdnEligibility(identity, application, workspace, workspace.parentWorkspace.id);
  }

  private async getUdnEligibility(
    identity: EligibilityIdentity,
    application: EligibilityApplication,
    school: WorkspaceContext,
    universityWorkspaceId: string,
  ): Promise<EligibilityCalculation> {
    const recipients = await this.repository.findConfirmedUniversityRecipients({
      issuerWorkspaceId: universityWorkspaceId,
      institutionWorkspaceId: school.id,
      schoolYear: application.schoolYear,
    });
    const verificationBasisHash = createVerificationBasisHash({
      application,
      school,
      universityWorkspaceId,
      identity,
      recipients,
    });

    const studentCode = normalizeStudentCode(identity.studentCode);
    if (
      studentCode &&
      recipients.some((recipient) => normalizeStudentCode(recipient.studentCode) === studentCode)
    ) {
      return {
        result: udnResult(application, 'ELIGIBLE', []),
        verificationBasisHash,
      };
    }

    const fullName = normalizeText(identity.fullName);
    const className = normalizeText(identity.className ?? '');
    const identityMatches = fullName && className
      ? recipients.filter(
          (recipient) =>
            normalizeText(recipient.fullName) === fullName &&
            normalizeText(recipient.className ?? '') === className,
        )
      : [];

    if (identityMatches.length > 1) {
      return {
        result: udnResult(application, 'NEEDS_VERIFICATION', [
          'AMBIGUOUS_UNIVERSITY_SYSTEM_AWARD_MATCH',
        ]),
        verificationBasisHash,
      };
    }

    if (identityMatches.length === 1) {
      return {
        result: udnResult(application, 'NEEDS_VERIFICATION', [
          'IDENTITY_MATCH_REQUIRES_VERIFICATION',
        ]),
        verificationBasisHash,
      };
    }

    if (!studentCode && (!fullName || !className)) {
      return {
        result: udnResult(application, 'NOT_ELIGIBLE', ['MISSING_IDENTITY_CONTEXT']),
        verificationBasisHash,
      };
    }

    const reasons: CitySubmissionEligibility['reasons'] = ['MISSING_UNIVERSITY_SYSTEM_AWARD'];
    if (!fullName || !className) reasons.push('MISSING_IDENTITY_CONTEXT');
    return {
      result: udnResult(application, 'NOT_ELIGIBLE', reasons),
      verificationBasisHash,
    };
  }
}

function createVerificationBasisHash(input: {
  application: EligibilityApplication;
  school: WorkspaceContext;
  universityWorkspaceId: string;
  identity: EligibilityIdentity;
  recipients: VerificationBasisRecipient[];
}): string {
  const recipients = input.recipients
    .map((recipient) => ({
      studentCode: normalizeStudentCode(recipient.studentCode),
      fullName: normalizeText(recipient.fullName),
      className: normalizeText(recipient.className ?? ''),
    }))
    .sort((left, right) => {
      const leftKey = JSON.stringify(left);
      const rightKey = JSON.stringify(right);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
  const basis = {
    applicationId: input.application.id,
    schoolYear: input.application.schoolYear,
    workspaceId: input.application.workspaceId,
    route: 'UDN_PREREQUISITE',
    schoolType: input.school.type,
    parentWorkspaceId: input.school.parentWorkspaceId,
    parentWorkspaceType: input.school.parentWorkspace?.type ?? null,
    universityWorkspaceId: input.universityWorkspaceId,
    studentId: input.application.studentId,
    identity: {
      workspaceId: input.application.workspaceId,
      studentCode: normalizeStudentCode(input.identity.studentCode),
      fullName: normalizeText(input.identity.fullName),
      className: normalizeText(input.identity.className ?? ''),
    },
    recipients,
  };

  return createHash('sha256').update(JSON.stringify(basis)).digest('hex');
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

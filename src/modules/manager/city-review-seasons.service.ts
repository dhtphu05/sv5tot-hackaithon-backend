import {
  ApplicationStatus,
  ApplicationType,
  Level,
  Role,
  WorkspaceType,
  type Prisma,
} from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { auditActions } from '../../shared/constants/application';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import type {
  CityReviewSeasonCreateInput,
  CityReviewSeasonUpdateInput,
  RevokeSubmissionWindowExceptionInput,
  SubmissionWindowExceptionInput,
} from './manager.validation';

const seasonDateFields = [
  'submissionOpensAt',
  'submissionClosesAt',
  'reviewDeadlineAt',
  'supplementDeadlineAt',
  'finalizationDeadlineAt',
] as const;

type SeasonDateField = (typeof seasonDateFields)[number];
type SeasonRecord = {
  id: string;
  schoolYear: string;
  submissionOpensAt: Date | null;
  submissionClosesAt: Date | null;
  reviewDeadlineAt: Date | null;
  supplementDeadlineAt: Date | null;
  finalizationDeadlineAt: Date | null;
  version: number;
  updatedAt?: Date;
  createdAt?: Date;
};

type ApplicationScopeRecord = {
  id: string;
  studentId: string;
  workspaceId: string;
  schoolYear: string;
  applicationType: ApplicationType;
  targetLevel: Level;
  status: ApplicationStatus;
  submittedAt: Date | null;
  workspace: { type: WorkspaceType; isActive: boolean };
  submissionWindowException?: {
    validUntil: Date;
    reason: string;
    grantedAt: Date;
    revokedAt: Date | null;
    revokeReason?: string | null;
    grantedById?: string;
  } | null;
};

const preSubmitStatuses = [
  ApplicationStatus.draft,
  ApplicationStatus.prechecked,
  ApplicationStatus.ready_to_submit,
  ApplicationStatus.supplement_required,
] as const;

export class CityReviewSeasonsService {
  async getSeason(user: AuthenticatedUser, schoolYear: string, now = new Date()) {
    assertCanManageSeasons(user);
    const season = (await prisma.cityReviewSeason.findUnique({ where: { schoolYear } })) as
      | SeasonRecord
      | null;
    return season ? toSeasonDto(season, now) : null;
  }

  async createSeason(user: AuthenticatedUser, input: CityReviewSeasonCreateInput) {
    assertCanManageSeasons(user);
    return prisma.$transaction(async (tx) => {
      const season = (await tx.cityReviewSeason.create({
        data: {
          schoolYear: input.schoolYear,
          ...toSeasonDateData(input),
        },
      })) as SeasonRecord;
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          actorRole: user.role,
          workspaceId: auditWorkspaceId(user),
          action: auditActions.CITY_REVIEW_SEASON_CREATED,
          targetType: 'city_review_season',
          targetId: season.id,
          afterStateJson: toSeasonAuditState(season),
          note: input.reason,
        },
      });
      return toSeasonDto(season);
    });
  }

  async updateSeason(user: AuthenticatedUser, schoolYear: string, input: CityReviewSeasonUpdateInput) {
    assertCanManageSeasons(user);
    return prisma.$transaction(async (tx) => {
      const before = (await tx.cityReviewSeason.findUnique({ where: { schoolYear } })) as
        | SeasonRecord
        | null;
      if (!before) {
        throw new AppError(404, ErrorCodes.CITY_REVIEW_SEASON_NOT_FOUND, 'Review season not found');
      }

      const dateData = toSeasonDateData(input);
      const update = await tx.cityReviewSeason.updateMany({
        where: { schoolYear, version: input.expectedVersion },
        data: { ...dateData, version: { increment: 1 } },
      });
      if (update.count !== 1) {
        throw new AppError(
          409,
          ErrorCodes.CITY_REVIEW_SEASON_VERSION_CONFLICT,
          'Review season changed. Refresh and try again.',
        );
      }

      const after = (await tx.cityReviewSeason.findUnique({ where: { schoolYear } })) as
        | SeasonRecord
        | null;
      if (!after) {
        throw new AppError(404, ErrorCodes.CITY_REVIEW_SEASON_NOT_FOUND, 'Review season not found');
      }
      for (const field of seasonDateFields) {
        if (sameInstant(before[field], after[field])) continue;
        await tx.auditLog.create({
          data: {
            actorId: user.id,
            actorRole: user.role,
            workspaceId: auditWorkspaceId(user),
            action: auditActions.CITY_REVIEW_SEASON_FIELD_UPDATED,
            targetType: 'city_review_season',
            targetId: after.id,
            beforeStateJson: { [field]: before[field]?.toISOString() ?? null },
            afterStateJson: { [field]: after[field]?.toISOString() ?? null },
            note: input.reason,
          },
        });
      }
      return toSeasonDto(after);
    });
  }

  async getStudentDeadline(user: AuthenticatedUser, applicationId: string, now = new Date()) {
    if (user.role !== Role.student || !user.workspaceId) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Only students can view their submission deadline');
    }
    const application = (await prisma.application.findFirst({
      where: {
        id: applicationId,
        studentId: user.id,
        workspaceId: user.workspaceId,
        applicationType: ApplicationType.individual,
        targetLevel: Level.city,
        workspace: { is: { type: WorkspaceType.SCHOOL, isActive: true } },
      },
      include: { submissionWindowException: true },
    })) as ApplicationScopeRecord | null;
    if (!application) {
      throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
    }
    const season = (await prisma.cityReviewSeason.findUnique({
      where: { schoolYear: application.schoolYear },
    })) as SeasonRecord | null;
    return toDeadlineDto(application, season, now, false);
  }

  async getManagerDeadline(user: AuthenticatedUser, applicationId: string, now = new Date()) {
    assertCanReadManagerDeadline(user);
    const application = await findScopedCityApplication(prisma, user, applicationId, true);
    const season = (await prisma.cityReviewSeason.findUnique({
      where: { schoolYear: application.schoolYear },
    })) as SeasonRecord | null;
    return toDeadlineDto(application, season, now, true);
  }

  async grantException(
    user: AuthenticatedUser,
    applicationId: string,
    input: SubmissionWindowExceptionInput,
  ) {
    assertCanReadManagerDeadline(user);
    return prisma.$transaction(async (tx) => {
      const application = await lockScopedInitialApplication(tx, user, applicationId);
      const season = (await tx.$queryRaw<SeasonRecord[]>`
        SELECT "id", "schoolYear", "submissionOpensAt", "submissionClosesAt",
          "reviewDeadlineAt", "supplementDeadlineAt", "finalizationDeadlineAt", "version",
          "createdAt", "updatedAt"
        FROM "CityReviewSeason"
        WHERE "schoolYear" = ${application.schoolYear}
        FOR SHARE
      `)[0];
      if (!season?.submissionOpensAt || !season.submissionClosesAt) {
        throw notConfiguredError();
      }
      const validUntil = new Date(input.validUntil);
      const now = new Date();
      if (validUntil <= now) {
        throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'Exception expiration must be in the future');
      }
      if (validUntil <= season.submissionClosesAt) {
        throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'Exception must extend the submission close time');
      }

      const previous = await tx.citySubmissionWindowException.findUnique({
        where: { applicationId },
      });
      const exception = await tx.citySubmissionWindowException.upsert({
        where: { applicationId },
        create: {
          applicationId,
          validUntil,
          reason: input.reason,
          grantedById: user.id,
          grantedAt: now,
        },
        update: {
          validUntil,
          reason: input.reason,
          grantedById: user.id,
          grantedAt: now,
          revokedAt: null,
          revokedById: null,
          revokeReason: null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          actorRole: user.role,
          workspaceId: auditWorkspaceId(user),
          applicationId,
          action: auditActions.CITY_SUBMISSION_WINDOW_EXCEPTION_GRANTED,
          targetType: 'city_submission_window_exception',
          targetId: applicationId,
          beforeStateJson: previous ? toExceptionAuditState(previous) : undefined,
          afterStateJson: toExceptionAuditState(exception),
          note: input.reason,
        },
      });
      return toExceptionDto(exception);
    });
  }

  async revokeException(
    user: AuthenticatedUser,
    applicationId: string,
    input: RevokeSubmissionWindowExceptionInput,
  ) {
    assertCanReadManagerDeadline(user);
    return prisma.$transaction(async (tx) => {
      await lockScopedInitialApplication(tx, user, applicationId);
      const previous = await tx.citySubmissionWindowException.findUnique({
        where: { applicationId },
      });
      if (!previous || previous.revokedAt) {
        throw new AppError(
          404,
          ErrorCodes.CITY_SUBMISSION_EXCEPTION_NOT_FOUND,
          'Active submission exception not found',
        );
      }
      const exception = await tx.citySubmissionWindowException.update({
        where: { applicationId },
        data: { revokedAt: new Date(), revokedById: user.id, revokeReason: input.reason },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          actorRole: user.role,
          workspaceId: auditWorkspaceId(user),
          applicationId,
          action: auditActions.CITY_SUBMISSION_WINDOW_EXCEPTION_REVOKED,
          targetType: 'city_submission_window_exception',
          targetId: applicationId,
          beforeStateJson: toExceptionAuditState(previous),
          afterStateJson: toExceptionAuditState(exception),
          note: input.reason,
        },
      });
      return toExceptionDto(exception);
    });
  }

  static async assertInitialSubmissionWindowOpen(
    tx: Prisma.TransactionClient,
    application: Pick<ApplicationScopeRecord, 'id' | 'schoolYear'>,
    now = new Date(),
  ): Promise<void> {
    const season = (await tx.$queryRaw<SeasonRecord[]>`
      SELECT "id", "schoolYear", "submissionOpensAt", "submissionClosesAt",
        "reviewDeadlineAt", "supplementDeadlineAt", "finalizationDeadlineAt", "version",
        "createdAt", "updatedAt"
      FROM "CityReviewSeason"
      WHERE "schoolYear" = ${application.schoolYear}
      FOR SHARE
    `)[0];
    if (!season?.submissionOpensAt || !season.submissionClosesAt) throw notConfiguredError();

    const exception = (await tx.$queryRaw<Array<{ validUntil: Date; revokedAt: Date | null }>>`
      SELECT "validUntil", "revokedAt"
      FROM "CitySubmissionWindowException"
      WHERE "applicationId" = ${application.id}::uuid
      FOR SHARE
    `)[0];
    const effectiveClose = exception && !exception.revokedAt
      ? new Date(Math.max(season.submissionClosesAt.getTime(), exception.validUntil.getTime()))
      : season.submissionClosesAt;

    if (now < season.submissionOpensAt) {
      throw new AppError(409, ErrorCodes.CITY_SUBMISSION_NOT_OPEN, 'City submission has not opened yet');
    }
    if (now > effectiveClose) {
      throw new AppError(409, ErrorCodes.CITY_SUBMISSION_CLOSED, 'City submission window is closed');
    }
  }

  static async assertSupplementResubmissionBeforeDeadline(
    tx: Prisma.TransactionClient,
    application: Pick<ApplicationScopeRecord, 'schoolYear' | 'submittedAt' | 'status'>,
    now = new Date(),
  ): Promise<void> {
    if (application.status !== ApplicationStatus.supplement_required || !application.submittedAt) return;
    const season = (await tx.$queryRaw<Array<{ supplementDeadlineAt: Date | null }>>`
      SELECT "supplementDeadlineAt"
      FROM "CityReviewSeason"
      WHERE "schoolYear" = ${application.schoolYear}
      FOR SHARE
    `)[0];
    if (season?.supplementDeadlineAt && now > season.supplementDeadlineAt) {
      throw new AppError(
        409,
        ErrorCodes.CITY_SUPPLEMENT_WINDOW_CLOSED,
        'City supplement resubmission window is closed',
      );
    }
  }
}

function assertCanManageSeasons(user: AuthenticatedUser): void {
  if (user.role === Role.admin) return;
  if (
    user.role === Role.city_manager &&
    user.workspaceId &&
    user.workspace?.id === user.workspaceId &&
    user.workspace.type === WorkspaceType.CITY
  ) return;
  throw new AppError(403, ErrorCodes.FORBIDDEN, 'Only a City Manager or admin can manage review seasons');
}

function assertCanReadManagerDeadline(user: AuthenticatedUser): void {
  if (user.role === Role.admin) return;
  if (
    user.role === Role.city_manager &&
    user.workspaceId &&
    user.workspace?.id === user.workspaceId &&
    user.workspace.type === WorkspaceType.CITY
  ) return;
  throw new AppError(403, ErrorCodes.FORBIDDEN, 'Only a City Manager or admin can manage City deadlines');
}

async function findScopedCityApplication(
  db: Pick<typeof prisma, 'application'>,
  user: AuthenticatedUser,
  applicationId: string,
  includeException: boolean,
): Promise<ApplicationScopeRecord> {
  const where: Prisma.ApplicationWhereInput = {
    id: applicationId,
    applicationType: ApplicationType.individual,
    targetLevel: Level.city,
    ...(user.role === Role.admin
      ? {}
      : { workspace: { is: { type: WorkspaceType.SCHOOL, isActive: true } } }),
  };
  const application = (await db.application.findFirst({
    where,
    include: {
      workspace: { select: { type: true, isActive: true } },
      ...(includeException ? { submissionWindowException: true } : {}),
    },
  })) as ApplicationScopeRecord | null;
  if (
    !application ||
    (user.role !== Role.admin &&
      (application.workspace.type !== WorkspaceType.SCHOOL || !application.workspace.isActive))
  ) {
    throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
  }
  return application;
}

async function lockScopedInitialApplication(
  tx: Prisma.TransactionClient,
  user: AuthenticatedUser,
  applicationId: string,
): Promise<ApplicationScopeRecord> {
  const initial = await findScopedCityApplication(tx, user, applicationId, true);
  if (initial.submittedAt || !preSubmitStatuses.includes(initial.status as (typeof preSubmitStatuses)[number])) {
    throw new AppError(409, ErrorCodes.APPLICATION_LOCKED, 'Submission exception requires an unsubmitted City application');
  }
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Application" WHERE "id" = ${applicationId}::uuid FOR UPDATE
  `;
  if (locked.length !== 1) {
    throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
  }
  const current = await findScopedCityApplication(tx, user, applicationId, true);
  if (current.submittedAt || !preSubmitStatuses.includes(current.status as (typeof preSubmitStatuses)[number])) {
    throw new AppError(409, ErrorCodes.APPLICATION_LOCKED, 'Submission exception requires an unsubmitted City application');
  }
  return current;
}

function toSeasonDateData(input: Pick<CityReviewSeasonCreateInput, SeasonDateField>) {
  return Object.fromEntries(
    seasonDateFields.map((field) => [field, input[field] === null ? null : new Date(input[field])]),
  ) as Record<SeasonDateField, Date | null>;
}

function toSeasonDto(season: SeasonRecord, now = new Date()) {
  return {
    id: season.id,
    schoolYear: season.schoolYear,
    submissionOpensAt: dateIso(season.submissionOpensAt),
    submissionClosesAt: dateIso(season.submissionClosesAt),
    reviewDeadlineAt: dateIso(season.reviewDeadlineAt),
    supplementDeadlineAt: dateIso(season.supplementDeadlineAt),
    finalizationDeadlineAt: dateIso(season.finalizationDeadlineAt),
    version: season.version,
    updatedAt: dateIso(season.updatedAt),
    submissionStatus: submissionWindowStatus(season.submissionOpensAt, season.submissionClosesAt, now),
    reviewStatus: deadlineStatus(season.reviewDeadlineAt, now),
    supplementStatus: deadlineStatus(season.supplementDeadlineAt, now),
    finalizationStatus: deadlineStatus(season.finalizationDeadlineAt, now),
  };
}

function toDeadlineDto(
  application: ApplicationScopeRecord,
  season: SeasonRecord | null,
  now: Date,
  includeManagerFields: boolean,
) {
  const exception = application.submissionWindowException ?? null;
  const effectiveClosesAt = effectiveSubmissionClose(season, exception);
  return {
    applicationId: application.id,
    schoolYear: application.schoolYear,
    submission: {
      status: submissionDeadlineStatus(season, exception, now),
      opensAt: dateIso(season?.submissionOpensAt),
      closesAt: dateIso(season?.submissionClosesAt),
      effectiveClosesAt: dateIso(effectiveClosesAt),
      exceptionActive: Boolean(exception && !exception.revokedAt && now <= exception.validUntil),
      exceptionValidUntil: dateIso(exception?.validUntil),
    },
    review: {
      deadlineAt: dateIso(season?.reviewDeadlineAt),
      status: deadlineStatus(season?.reviewDeadlineAt ?? null, now),
    },
    supplement: {
      deadlineAt: dateIso(season?.supplementDeadlineAt),
      status: deadlineStatus(season?.supplementDeadlineAt ?? null, now),
    },
    finalization: {
      deadlineAt: dateIso(season?.finalizationDeadlineAt),
      status: deadlineStatus(season?.finalizationDeadlineAt ?? null, now),
    },
    ...(includeManagerFields
      ? {
          application: { status: application.status, submittedAt: dateIso(application.submittedAt) },
          exception: exception
            ? {
                validUntil: exception.validUntil.toISOString(),
                reason: exception.reason,
                grantedAt: exception.grantedAt.toISOString(),
                revokedAt: dateIso(exception.revokedAt),
              }
            : null,
        }
      : {}),
  };
}

function effectiveSubmissionClose(
  season: SeasonRecord | null,
  exception: ApplicationScopeRecord['submissionWindowException'],
): Date | null {
  const close = season?.submissionClosesAt ?? null;
  if (!close || !exception || exception.revokedAt) return close;
  return new Date(Math.max(close.getTime(), exception.validUntil.getTime()));
}

function submissionWindowStatus(opensAt: Date | null, closesAt: Date | null, now: Date) {
  if (!opensAt || !closesAt) return 'NOT_CONFIGURED';
  if (now < opensAt) return 'NOT_OPEN';
  if (now > closesAt) return 'CLOSED';
  return 'OPEN';
}

function submissionDeadlineStatus(
  season: SeasonRecord | null,
  exception: ApplicationScopeRecord['submissionWindowException'],
  now: Date,
) {
  const opensAt = season?.submissionOpensAt ?? null;
  const closesAt = season?.submissionClosesAt ?? null;
  if (!opensAt || !closesAt) return 'NOT_CONFIGURED';
  if (now < opensAt) return 'NOT_OPEN';
  const effectiveClose = effectiveSubmissionClose(season, exception);
  if (effectiveClose && now > effectiveClose) return 'CLOSED';
  if (
    exception &&
    !exception.revokedAt &&
    exception.validUntil > closesAt &&
    now > closesAt &&
    now <= exception.validUntil
  ) return 'EXCEPTION_ACTIVE';
  return 'OPEN';
}

function deadlineStatus(deadlineAt: Date | null, now: Date) {
  if (!deadlineAt) return 'NOT_CONFIGURED';
  return now > deadlineAt ? 'OVERDUE' : 'ON_TRACK';
}

function notConfiguredError() {
  return new AppError(
    409,
    ErrorCodes.CITY_SUBMISSION_WINDOW_NOT_CONFIGURED,
    'City submission window is not configured for this school year',
  );
}

function auditWorkspaceId(user: AuthenticatedUser): string | null {
  return user.role === Role.city_manager ? user.workspaceId : null;
}

function toSeasonAuditState(season: SeasonRecord) {
  return {
    schoolYear: season.schoolYear,
    submissionOpensAt: dateIso(season.submissionOpensAt),
    submissionClosesAt: dateIso(season.submissionClosesAt),
    reviewDeadlineAt: dateIso(season.reviewDeadlineAt),
    supplementDeadlineAt: dateIso(season.supplementDeadlineAt),
    finalizationDeadlineAt: dateIso(season.finalizationDeadlineAt),
    version: season.version,
  };
}

function toExceptionAuditState(exception: {
  validUntil: Date;
  reason: string;
  grantedById?: string;
  grantedAt: Date;
  revokedAt: Date | null;
  revokedById?: string | null;
  revokeReason?: string | null;
}) {
  return {
    validUntil: exception.validUntil.toISOString(),
    reason: exception.reason,
    grantedById: exception.grantedById,
    grantedAt: exception.grantedAt.toISOString(),
    revokedAt: dateIso(exception.revokedAt),
    revokedById: exception.revokedById,
    revokeReason: exception.revokeReason,
  };
}

function toExceptionDto(exception: {
  applicationId: string;
  validUntil: Date;
  reason: string;
  grantedAt: Date;
  revokedAt: Date | null;
}) {
  return {
    applicationId: exception.applicationId,
    validUntil: exception.validUntil.toISOString(),
    reason: exception.reason,
    grantedAt: exception.grantedAt.toISOString(),
    revokedAt: dateIso(exception.revokedAt),
  };
}

function dateIso(value: Date | null | undefined): string | null {
  return value?.toISOString() ?? null;
}

function sameInstant(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime();
}

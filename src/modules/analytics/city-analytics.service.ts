import {
  ApplicationStatus,
  ApplicationType,
  Criterion,
  FinalStatus,
  Level,
  ResolutionStatus,
  ReviewTaskStatus,
  Role,
  WorkspaceType,
  type Prisma,
} from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import type { CityApplicationListItem } from './city-analytics.dto';
import type { CityAnalyticsApplicationsQuery, CityAnalyticsQuery } from './city-analytics.validation';

const cityCriteria = [
  Criterion.ethics,
  Criterion.academic,
  Criterion.physical,
  Criterion.volunteer,
  Criterion.integration,
] as const;
const cityCriterionSet = new Set<Criterion>(cityCriteria);
const terminalTaskStatuses = new Set<ReviewTaskStatus>([
  ReviewTaskStatus.accepted,
  ReviewTaskStatus.rejected,
]);
const openTaskStatuses = new Set<ReviewTaskStatus>([
  ReviewTaskStatus.waiting,
  ReviewTaskStatus.reviewing,
  ReviewTaskStatus.supplement_required,
  ReviewTaskStatus.resolution_needed,
]);
const openResolutionStatuses = new Set<ResolutionStatus>([
  ResolutionStatus.open,
  ResolutionStatus.in_review,
]);
const resolvedResolutionStatuses = new Set<ResolutionStatus>([
  ResolutionStatus.resolved,
  ResolutionStatus.rejected,
]);

type ReviewTaskRow = { criterion: Criterion; status: ReviewTaskStatus; assignedOfficerId?: string | null };
type ResolutionRow = { status: ResolutionStatus };
type ApplicationRow = {
  id: string;
  workspaceId: string;
  schoolYear: string;
  applicationType: ApplicationType;
  targetLevel: Level;
  status: ApplicationStatus;
  submittedAt: Date | null;
  finalStatus: FinalStatus;
  workspace: { id: string; code: string; name: string };
  reviewTasks: ReviewTaskRow[];
  resolutionCases: ResolutionRow[];
  student?: { fullName: string; studentCode: string | null };
};

export class CityAnalyticsService {
  async getSummary(user: AuthenticatedUser, query: CityAnalyticsQuery) {
    authorizeCityAnalytics(user);
    const [yearGroups, schools, officers] = await Promise.all([
      prisma.application.groupBy({
        by: ['schoolYear'],
        where: cityApplicationWhere(),
        orderBy: { schoolYear: 'desc' },
      }),
      prisma.workspace.findMany({
        where: { type: WorkspaceType.SCHOOL, isActive: true },
        select: { id: true, code: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.user.findMany({
        where: {
          ...(user.role === Role.city_manager ? { workspaceId: user.workspaceId! } : {}),
          role: Role.city_officer,
          isActive: true,
          workspace: { is: { type: WorkspaceType.CITY, isActive: true } },
        },
        select: { id: true, fullName: true },
        orderBy: { fullName: 'asc' },
      }),
    ]);

    const availableSchoolYears = yearGroups.map((item) => item.schoolYear);
    const schoolYear = query.schoolYear ?? availableSchoolYears[0] ?? null;
    const filterWhere = cityApplicationWhere({ ...query, schoolYear: schoolYear ?? undefined });
    const rows = schoolYear
      ? ((await prisma.application.findMany({
          where: filterWhere,
          select: {
            id: true,
            workspaceId: true,
            schoolYear: true,
            applicationType: true,
            targetLevel: true,
            status: true,
            submittedAt: true,
            finalStatus: true,
            workspace: { select: { id: true, code: true, name: true } },
            reviewTasks: { select: { criterion: true, status: true, assignedOfficerId: true } },
            resolutionCases: { select: { status: true } },
          },
        })) as ApplicationRow[])
      : [];

    return summarize(rows, {
      schoolYear,
      workspaceId: query.workspaceId ?? null,
      status: query.status ?? null,
    }, availableSchoolYears, schools, officers);
  }

  async listApplications(user: AuthenticatedUser, query: CityAnalyticsApplicationsQuery) {
    authorizeCityAnalytics(user);
    const yearGroups = await prisma.application.groupBy({
      by: ['schoolYear'],
      where: cityApplicationWhere(),
      orderBy: { schoolYear: 'desc' },
    });
    const schoolYear = query.schoolYear ?? yearGroups[0]?.schoolYear;
    const where = cityApplicationWhere({ ...query, schoolYear });
    if (query.finalStatus) where.finalStatus = query.finalStatus;
    const andFilters: Prisma.ApplicationWhereInput[] = [];
    if (query.submitted !== undefined) {
      where.submittedAt = query.submitted ? { not: null } : null;
    }
    if (query.inReview !== undefined) {
      const inReviewFilter: Prisma.ApplicationWhereInput = {
        submittedAt: { not: null },
        status: { in: [ApplicationStatus.submitted, ApplicationStatus.under_review] },
      };
      andFilters.push(query.inReview ? inReviewFilter : { NOT: inReviewFilter });
    }
    if (query.criterion || query.taskStatus) {
      where.reviewTasks = {
        some: {
          ...(query.criterion ? { criterion: query.criterion } : {}),
          ...(query.taskStatus ? { status: query.taskStatus } : {}),
        },
      };
    }
    if (query.q) {
      andFilters.push({ OR: [
        { student: { fullName: { contains: query.q, mode: 'insensitive' } } },
        { student: { studentCode: { contains: query.q, mode: 'insensitive' } } },
        { workspace: { is: { name: { contains: query.q, mode: 'insensitive' } } } },
        { workspace: { is: { code: { contains: query.q, mode: 'insensitive' } } } },
      ] });
    }
    if (query.supplementRequired !== undefined) {
      const supplementFilter: Prisma.ApplicationWhereInput = {
        OR: [
          { status: ApplicationStatus.supplement_required },
          { reviewTasks: { some: { status: ReviewTaskStatus.supplement_required } } },
        ],
      };
      andFilters.push(query.supplementRequired ? supplementFilter : { NOT: supplementFilter });
    }
    if (query.resolutionBlocked !== undefined) {
      const resolutionFilter: Prisma.ApplicationWhereInput = {
        OR: [
          { status: ApplicationStatus.resolution_needed },
          { reviewTasks: { some: { status: ReviewTaskStatus.resolution_needed } } },
          { resolutionCases: { some: { status: { in: [...openResolutionStatuses] } } } },
        ],
      };
      andFilters.push(query.resolutionBlocked ? resolutionFilter : { NOT: resolutionFilter });
    }
    if (andFilters.length) where.AND = andFilters;

    const skip = (query.page - 1) * query.limit;
    const [applications, total] = await Promise.all([
      prisma.application.findMany({
        where,
        select: {
          id: true,
          schoolYear: true,
          status: true,
          submittedAt: true,
          finalStatus: true,
          workspace: { select: { id: true, code: true, name: true } },
          student: { select: { fullName: true, studentCode: true } },
          reviewTasks: { select: { criterion: true, status: true } },
          resolutionCases: { select: { status: true } },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip,
        take: query.limit,
      }),
      prisma.application.count({ where }),
    ]);
    const items = applications.map((application) => {
      const progress = reviewProgress(application.reviewTasks);
      return {
        id: application.id,
        schoolYear: application.schoolYear,
        status: application.status,
        submittedAt: application.submittedAt?.toISOString() ?? null,
        reviewProgress: {
          reviewed: progress.reviewed,
          expected: 5 as const,
          anomalous: Boolean(application.submittedAt && (progress.missingSlots > 0 || progress.unexpectedTasks > 0)),
        },
        finalStatus: application.finalStatus,
        supplementRequired: isSupplementRequired(application),
        resolutionBlocked: isResolutionBlocked(application),
        student: application.student,
        school: {
          workspaceId: application.workspace.id,
          code: application.workspace.code,
          name: application.workspace.name,
        },
      } satisfies CityApplicationListItem;
    });

    return {
      items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }
}

function authorizeCityAnalytics(user: AuthenticatedUser): void {
  if (user.role === Role.admin) return;
  if (user.role !== Role.city_manager) {
    throw new AppError(403, ErrorCodes.FORBIDDEN, 'This role cannot view City analytics');
  }
  if (
    !user.workspaceId ||
    user.workspace?.id !== user.workspaceId ||
    user.workspace.type !== WorkspaceType.CITY
  ) {
    throw new AppError(403, ErrorCodes.PERMISSION_DENIED, 'City workspace access is required');
  }
}

function cityApplicationWhere(filters: {
  schoolYear?: string;
  workspaceId?: string;
  status?: ApplicationStatus;
} = {}): Prisma.ApplicationWhereInput {
  return {
    applicationType: ApplicationType.individual,
    targetLevel: Level.city,
    workspace: { is: { type: WorkspaceType.SCHOOL, isActive: true } },
    ...(filters.schoolYear ? { schoolYear: filters.schoolYear } : {}),
    ...(filters.workspaceId ? { workspaceId: filters.workspaceId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  };
}

function summarize(
  rows: ApplicationRow[],
  filters: { schoolYear: string | null; workspaceId: string | null; status: ApplicationStatus | null },
  availableSchoolYears: string[],
  schools: Array<{ id: string; code: string; name: string }>,
  officers: Array<{ id: string; fullName: string }>,
) {
  const applications = {
    created: rows.length,
    notSubmitted: 0,
    submitted: 0,
    inReview: 0,
    supplementRequired: 0,
    resolutionBlocked: 0,
    reviewComplete: 0,
    progressDistribution: { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
    unexpectedTaskCount: 0,
    missingCriterionSlots: 0,
  };
  const criteria = cityCriteria.map((criterion) => ({
    criterion,
    totalTasks: 0,
    pending: 0,
    inReview: 0,
    supplementRequired: 0,
    resolutionNeeded: 0,
    pass: 0,
    fail: 0,
  }));
  const schoolMap = new Map<string, {
    workspaceId: string;
    code: string;
    name: string;
    submitted: number;
    inReview: number;
    supplementRequired: number;
    reviewComplete: number;
    finalPassed: number;
    finalFailed: number;
  }>();
  const officerMap = new Map(officers.map((officer) => [officer.id, {
    officerId: officer.id,
    fullName: officer.fullName,
    assignedActive: 0,
    pending: 0,
    completed: 0,
    supplementRequired: 0,
    resolutionNeeded: 0,
  }]));
  let finalized = 0;
  let passed = 0;
  let failed = 0;
  let partiallyPassed = 0;
  let notFinalized = 0;
  let supplementApplications = 0;
  let supplementTasks = 0;
  let openCases = 0;
  let resolvedCases = 0;
  let blockedApplications = 0;

  for (const application of rows) {
    const submitted = application.submittedAt !== null;
    if (!submitted) applications.notSubmitted += 1;
    else applications.submitted += 1;
    if (submitted && isInReview(application.status)) {
      applications.inReview += 1;
    }

    const progress = reviewProgress(application.reviewTasks);
    if (submitted) {
      applications.progressDistribution[String(progress.reviewed) as keyof typeof applications.progressDistribution] += 1;
      applications.unexpectedTaskCount += progress.unexpectedTasks;
      applications.missingCriterionSlots += progress.missingSlots;
    }
    const complete = submitted && progress.reviewed === 5 && !progress.anomalous;
    if (complete) applications.reviewComplete += 1;

    for (const task of application.reviewTasks) {
      const criterion = criteria.find((item) => item.criterion === task.criterion);
      if (!criterion) continue;
      criterion.totalTasks += 1;
      if (task.status === ReviewTaskStatus.waiting) criterion.pending += 1;
      if (task.status === ReviewTaskStatus.reviewing) criterion.inReview += 1;
      if (task.status === ReviewTaskStatus.supplement_required) criterion.supplementRequired += 1;
      if (task.status === ReviewTaskStatus.resolution_needed) criterion.resolutionNeeded += 1;
      if (task.status === ReviewTaskStatus.accepted) criterion.pass += 1;
      if (task.status === ReviewTaskStatus.rejected) criterion.fail += 1;

      if (task.assignedOfficerId) {
        const officer = officerMap.get(task.assignedOfficerId);
        if (officer) {
          if (openTaskStatuses.has(task.status)) officer.assignedActive += 1;
          if (task.status === ReviewTaskStatus.waiting || task.status === ReviewTaskStatus.reviewing) officer.pending += 1;
          if (terminalTaskStatuses.has(task.status)) officer.completed += 1;
          if (task.status === ReviewTaskStatus.supplement_required) officer.supplementRequired += 1;
          if (task.status === ReviewTaskStatus.resolution_needed) officer.resolutionNeeded += 1;
        }
      }
    }

    const supplementRequired = isSupplementRequired(application);
    if (supplementRequired) {
      supplementApplications += 1;
      applications.supplementRequired += 1;
    }
    const appSupplementTasks = application.reviewTasks.filter((task) => task.status === ReviewTaskStatus.supplement_required).length;
    supplementTasks += appSupplementTasks;
    const appOpenCases = application.resolutionCases.filter((item) => openResolutionStatuses.has(item.status)).length;
    const appResolvedCases = application.resolutionCases.filter((item) => resolvedResolutionStatuses.has(item.status)).length;
    openCases += appOpenCases;
    resolvedCases += appResolvedCases;
    const resolutionBlocked = isResolutionBlocked(application);
    if (resolutionBlocked) {
      blockedApplications += 1;
      applications.resolutionBlocked += 1;
    }

    if (submitted) {
      if (application.finalStatus === FinalStatus.passed) passed += 1;
      else if (application.finalStatus === FinalStatus.failed) failed += 1;
      else if (application.finalStatus === FinalStatus.partially_passed) partiallyPassed += 1;
      else notFinalized += 1;
      if (application.finalStatus !== FinalStatus.pending) finalized += 1;
    }

    const school = schoolMap.get(application.workspaceId) ?? {
      workspaceId: application.workspaceId,
      code: application.workspace.code,
      name: application.workspace.name,
      submitted: 0,
      inReview: 0,
      supplementRequired: 0,
      reviewComplete: 0,
      finalPassed: 0,
      finalFailed: 0,
    };
    if (submitted) school.submitted += 1;
    if (submitted && isInReview(application.status)) school.inReview += 1;
    if (supplementRequired) school.supplementRequired += 1;
    if (complete) school.reviewComplete += 1;
    if (submitted && application.finalStatus === FinalStatus.passed) school.finalPassed += 1;
    if (submitted && application.finalStatus === FinalStatus.failed) school.finalFailed += 1;
    schoolMap.set(application.workspaceId, school);
  }

  return {
    filters,
    availableSchoolYears,
    filterOptions: { schools: schools.map(({ id, code, name }) => ({ workspaceId: id, code, name })) },
    applications,
    criteria,
    bySchool: [...schoolMap.values()].sort((left, right) => left.name.localeCompare(right.name)),
    reviewers: [...officerMap.values()],
    finalResults: { finalized, passed, failed, partiallyPassed, notFinalized },
    supplement: { applications: supplementApplications, tasks: supplementTasks },
    resolution: { openCases, resolvedCases, blockedApplications },
  };
}

function reviewProgress(tasks: ReviewTaskRow[]) {
  const byCriterion = new Map<Criterion, ReviewTaskRow[]>();
  let unexpectedTasks = 0;
  for (const task of tasks) {
    if (!cityCriterionSet.has(task.criterion)) {
      unexpectedTasks += 1;
      continue;
    }
    const rows = byCriterion.get(task.criterion) ?? [];
    rows.push(task);
    byCriterion.set(task.criterion, rows);
  }

  for (const rows of byCriterion.values()) unexpectedTasks += Math.max(0, rows.length - 1);
  let reviewed = 0;
  let missingSlots = 0;
  for (const criterion of cityCriteria) {
    const rows = byCriterion.get(criterion) ?? [];
    if (rows.length === 0) missingSlots += 1;
    if (rows.length === 1 && terminalTaskStatuses.has(rows[0].status)) reviewed += 1;
  }
  return { reviewed, missingSlots, unexpectedTasks, anomalous: missingSlots > 0 || unexpectedTasks > 0 };
}

function isSupplementRequired(application: Pick<ApplicationRow, 'status' | 'reviewTasks'>): boolean {
  return application.status === ApplicationStatus.supplement_required ||
    application.reviewTasks.some((task) => task.status === ReviewTaskStatus.supplement_required);
}

function isInReview(status: ApplicationStatus): boolean {
  return status === ApplicationStatus.submitted || status === ApplicationStatus.under_review;
}

function isResolutionBlocked(
  application: Pick<ApplicationRow, 'status' | 'reviewTasks' | 'resolutionCases'>,
): boolean {
  return application.status === ApplicationStatus.resolution_needed ||
    application.reviewTasks.some((task) => task.status === ReviewTaskStatus.resolution_needed) ||
    application.resolutionCases.some((item) => openResolutionStatuses.has(item.status));
}

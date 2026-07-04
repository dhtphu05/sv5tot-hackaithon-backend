import { Criterion, Role, ReviewTaskStatus, type Prisma } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';

const demoAllCriteriaOfficerEmail = 'officer.academic@dut.udn.vn';
const demoReviewCriteria: Criterion[] = [
  Criterion.ethics,
  Criterion.academic,
  Criterion.physical,
  Criterion.volunteer,
  Criterion.integration,
];

const activeTaskStatuses = [
  ReviewTaskStatus.waiting,
  ReviewTaskStatus.reviewing,
  ReviewTaskStatus.supplement_required,
  ReviewTaskStatus.resolution_needed,
];

type DbClient = Prisma.TransactionClient | typeof prisma;

export class ReviewAssignmentService {
  async assignOfficerForCriterion(
    input: {
      criterion: Criterion;
      faculty?: string | null;
      excludeOfficerIds?: string[];
    },
    db: DbClient = prisma,
  ) {
    const specializations = await db.officerSpecialization.findMany({
      where: {
        criterion: input.criterion,
        isActive: true,
        officer: {
          role: Role.officer,
          isActive: true,
        },
      },
      include: { officer: true },
    });

    const scopedEligible = specializations.filter((item) => {
      if (!item.facultyScope) {
        return true;
      }
      return input.faculty ? item.facultyScope === input.faculty : false;
    });

    const eligible = scopedEligible.length > 0 ? scopedEligible : specializations;

    const filtered = eligible.filter((item) => !input.excludeOfficerIds?.includes(item.officerId));

    if (filtered.length === 0) {
      return null;
    }

    const demoOfficer = getDemoOfficerForCriterion(filtered, input.criterion, input.faculty);
    if (demoOfficer) {
      return demoOfficer.officer;
    }

    const workloads = await this.getOfficerWorkloads(
      filtered.map((item) => item.officerId),
      db,
    );

    const sorted = [...filtered].sort((a, b) => {
      const aFacultyRank = a.facultyScope === input.faculty ? 0 : 1;
      const bFacultyRank = b.facultyScope === input.faculty ? 0 : 1;
      if (aFacultyRank !== bFacultyRank) {
        return aFacultyRank - bFacultyRank;
      }
      return (workloads.get(a.officerId) ?? 0) - (workloads.get(b.officerId) ?? 0);
    });

    return sorted[0].officer;
  }

  async getOfficerWorkloads(
    officerIds: string[],
    db: DbClient = prisma,
  ): Promise<Map<string, number>> {
    if (officerIds.length === 0) {
      return new Map();
    }

    const grouped = await db.reviewTask.groupBy({
      by: ['assignedOfficerId'],
      where: {
        assignedOfficerId: { in: officerIds },
        status: { in: activeTaskStatuses },
      },
      _count: { _all: true },
    });

    return new Map(
      grouped
        .filter((item) => item.assignedOfficerId)
        .map((item) => [item.assignedOfficerId!, item._count._all]),
    );
  }

  async canOfficerHandleCriterion(
    officerId: string,
    criterion: Criterion,
    faculty?: string | null,
    db: DbClient = prisma,
  ): Promise<boolean> {
    const officer = await db.user.findUnique({
      where: { id: officerId },
      select: { email: true, role: true, isActive: true },
    });
    if (
      officer?.email === demoAllCriteriaOfficerEmail &&
      officer.role === Role.officer &&
      officer.isActive &&
      demoReviewCriteria.includes(criterion)
    ) {
      return true;
    }

    const specialization = await db.officerSpecialization.findFirst({
      where: {
        officerId,
        criterion,
        isActive: true,
        officer: { role: Role.officer, isActive: true },
        OR: [{ facultyScope: faculty ?? undefined }, { facultyScope: null }],
      },
    });

    return Boolean(specialization);
  }
}

function getDemoOfficerForCriterion<
  T extends { criterion: Criterion; facultyScope: string | null; officer: { email: string } },
>(items: T[], criterion: Criterion, faculty?: string | null): T | null {
  if (process.env.NODE_ENV === 'production' || !demoReviewCriteria.includes(criterion)) {
    return null;
  }

  const candidates = items.filter((item) => item.officer.email === demoAllCriteriaOfficerEmail);
  if (candidates.length === 0) {
    return null;
  }

  return (
    candidates.find((item) => item.facultyScope && item.facultyScope === faculty) ??
    candidates.find((item) => !item.facultyScope) ??
    candidates[0]
  );
}

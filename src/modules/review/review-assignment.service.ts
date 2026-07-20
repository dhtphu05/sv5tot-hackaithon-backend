import { Criterion, Role, ReviewTaskStatus, type Prisma } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { facultyMatches } from '../../shared/utils/faculty';

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
      return facultyMatches(item.facultyScope, input.faculty);
    });

    const eligible = scopedEligible.length > 0 ? scopedEligible : specializations;

    const filtered = eligible.filter((item) => !input.excludeOfficerIds?.includes(item.officerId));

    if (filtered.length === 0) {
      return null;
    }

    const workloads = await this.getOfficerWorkloads(
      filtered.map((item) => item.officerId),
      db,
    );

    const sorted = [...filtered].sort((a, b) => {
      const aFacultyRank = facultyMatches(a.facultyScope, input.faculty) ? 0 : 1;
      const bFacultyRank = facultyMatches(b.facultyScope, input.faculty) ? 0 : 1;
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
    _faculty?: string | null,
    db: DbClient = prisma,
  ): Promise<boolean> {
    const specialization = await db.officerSpecialization.findFirst({
      where: {
        officerId,
        criterion,
        isActive: true,
        officer: { role: Role.officer, isActive: true },
      },
    });

    return Boolean(specialization);
  }
}

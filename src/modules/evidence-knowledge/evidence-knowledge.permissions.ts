import { Criterion, Role, type Prisma } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { requireUserWorkspace } from '../../shared/utils/workspace-scope';

type DbClient = Prisma.TransactionClient | typeof prisma;

export async function resolveEvidenceKnowledgeScope(
  user: AuthenticatedUser,
  requestedCriterion?: Criterion,
  db: DbClient = prisma,
): Promise<{ workspaceId?: string; criteria?: Criterion[] }> {
  const workspaceId = user.role === Role.admin ? undefined : requireUserWorkspace(user);

  if (user.role === Role.manager || user.role === Role.committee || user.role === Role.admin) {
    return { workspaceId, criteria: requestedCriterion ? [requestedCriterion] : undefined };
  }

  if (user.role !== Role.officer) {
    throw new AppError(403, ErrorCodes.FORBIDDEN, 'Role cannot access officer evidence knowledge');
  }

  const specializations = await db.officerSpecialization.findMany({
    where: { officerId: user.id, isActive: true },
    select: { criterion: true },
  });
  const criteria = Array.from(new Set(specializations.map((item) => item.criterion)));
  if (!criteria.length) {
    throw new AppError(403, ErrorCodes.OFFICER_NOT_SPECIALIZED, 'Officer has no specialization');
  }
  if (requestedCriterion && !criteria.includes(requestedCriterion)) {
    throw new AppError(403, ErrorCodes.OFFICER_NOT_SPECIALIZED, 'Officer cannot access criterion');
  }

  return { workspaceId, criteria: requestedCriterion ? [requestedCriterion] : criteria };
}

export async function assertCanAccessEvidenceKnowledgeCriterion(
  user: AuthenticatedUser,
  criterion: Criterion,
  workspaceId: string,
  db: DbClient = prisma,
) {
  if (user.role !== Role.admin && user.workspaceId !== workspaceId) {
    throw new AppError(404, ErrorCodes.EVENT_NOT_FOUND, 'Approved event not found');
  }
  if (user.role === Role.manager || user.role === Role.committee || user.role === Role.admin) {
    return;
  }
  if (user.role !== Role.officer) {
    throw new AppError(403, ErrorCodes.FORBIDDEN, 'Role cannot access officer evidence knowledge');
  }
  const specialization = await db.officerSpecialization.findFirst({
    where: { officerId: user.id, criterion, isActive: true },
  });
  if (!specialization) {
    throw new AppError(403, ErrorCodes.OFFICER_NOT_SPECIALIZED, 'Officer cannot access criterion');
  }
}

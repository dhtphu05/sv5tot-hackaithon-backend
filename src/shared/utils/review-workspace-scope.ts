import { Role, WorkspaceType } from '@prisma/client';
import { AppError } from '../errors/app-error';
import { ErrorCodes } from '../errors/error-codes';
import type { AuthenticatedUser } from '../types/auth';
import { requireUserWorkspace, workspaceFilterFor } from './workspace-scope';

const cityReviewRoles = new Set<Role>([
  Role.city_officer,
  Role.city_manager,
  Role.city_committee,
]);

type ReviewWorkspaceFilter = {
  workspaceId?: string;
  workspace?: { is: { id?: string; type?: WorkspaceType; isActive?: boolean } };
  OR?: ReviewWorkspaceFilter[];
};

export function isCityReviewRole(role: Role): boolean {
  return cityReviewRoles.has(role);
}

export function reviewWorkspaceFilterFor(user: AuthenticatedUser): ReviewWorkspaceFilter {
  if (user.role === Role.admin) return {};
  if (!isCityReviewRole(user.role)) return workspaceFilterFor(user);

  requireCityWorkspace(user);
  return { workspace: { is: { type: WorkspaceType.SCHOOL, isActive: true } } };
}

export function reviewKnowledgeWorkspaceFilterFor(
  user: AuthenticatedUser,
): ReviewWorkspaceFilter {
  if (!isCityReviewRole(user.role)) return workspaceFilterFor(user);
  requireCityWorkspace(user);
  return {
    OR: [
      { workspaceId: requireUserWorkspace(user) },
      { workspace: { is: { type: WorkspaceType.SCHOOL, isActive: true } } },
    ],
  };
}

export function assertReviewWorkspaceAccess(
  user: AuthenticatedUser,
  resource: {
    workspaceId: string | null;
    workspaceType?: WorkspaceType | null;
    workspaceIsActive?: boolean | null;
  },
  notFoundMessage = 'Resource not found',
): void {
  if (user.role === Role.admin) return;

  if (isCityReviewRole(user.role)) {
    requireCityWorkspace(user);
    if (
      resource.workspaceId &&
      resource.workspaceType === WorkspaceType.SCHOOL &&
      resource.workspaceIsActive === true
    ) {
      return;
    }
  } else if (resource.workspaceId === requireUserWorkspace(user)) {
    return;
  }

  throw new AppError(404, ErrorCodes.NOT_FOUND, notFoundMessage);
}

function requireCityWorkspace(user: AuthenticatedUser): string {
  if (
    user.workspaceId &&
    user.workspace?.id === user.workspaceId &&
    user.workspace.type === WorkspaceType.CITY
  ) {
    return user.workspaceId;
  }
  throw new AppError(403, ErrorCodes.PERMISSION_DENIED, 'City workspace access is required');
}

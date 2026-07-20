import { Role } from '@prisma/client';
import { AppError } from '../errors/app-error';
import { ErrorCodes } from '../errors/error-codes';
import type { AuthenticatedUser } from '../types/auth';

export function requireUserWorkspace(user: AuthenticatedUser): string {
  if (user.workspaceId) return user.workspaceId;
  throw new AppError(
    403,
    ErrorCodes.USER_WORKSPACE_REQUIRED,
    'User account is missing workspace configuration',
  );
}

export function workspaceIdForWrite(user: AuthenticatedUser): string {
  return requireUserWorkspace(user);
}

export function workspaceFilterFor(user: AuthenticatedUser): { workspaceId?: string } {
  return user.role === Role.admin ? {} : { workspaceId: requireUserWorkspace(user) };
}

export function assertSameWorkspace(
  user: AuthenticatedUser,
  entity: { workspaceId?: string | null },
  notFoundMessage = 'Resource not found',
): void {
  if (user.role === Role.admin) return;
  if (entity.workspaceId && entity.workspaceId === requireUserWorkspace(user)) return;
  throw new AppError(404, ErrorCodes.NOT_FOUND, notFoundMessage);
}

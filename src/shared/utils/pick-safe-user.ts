import type { User, Workspace } from '@prisma/client';

export type WorkspaceSummary = Pick<Workspace, 'id' | 'code' | 'name' | 'shortName'>;

type UserWithWorkspace = User & {
  workspace?: WorkspaceSummary | null;
};

export type SafeUser = Pick<
  User,
  | 'id'
  | 'workspaceId'
  | 'fullName'
  | 'email'
  | 'phone'
  | 'role'
  | 'studentCode'
  | 'className'
  | 'faculty'
  | 'avatarUrl'
  | 'isActive'
  | 'lastLoginAt'
  | 'createdAt'
  | 'updatedAt'
> & {
  workspace: WorkspaceSummary | null;
};

export function pickSafeUser(user: UserWithWorkspace): SafeUser {
  return {
    id: user.id,
    workspaceId: user.workspaceId,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    role: user.role,
    studentCode: user.studentCode,
    className: user.className,
    faculty: user.faculty,
    avatarUrl: user.avatarUrl,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    workspace: user.workspace
      ? {
          id: user.workspace.id,
          code: user.workspace.code,
          name: user.workspace.name,
          shortName: user.workspace.shortName,
        }
      : null,
  };
}

import type { Role } from '@prisma/client';

export type AuthenticatedUser = {
  id: string;
  workspaceId: string | null;
  email: string;
  role: Role;
  fullName: string;
  studentCode: string | null;
  className: string | null;
  faculty: string | null;
  avatarUrl: string | null;
  workspace: {
    id: string;
    code: string;
    name: string;
    shortName: string | null;
  } | null;
};

export type AccessTokenPayload = {
  sub: string;
  type: 'access';
};

export type RefreshTokenPayload = {
  sub: string;
  type: 'refresh';
  jti: string;
};

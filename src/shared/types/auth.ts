import type { Role } from '@prisma/client';

export type AuthenticatedUser = {
  id: string;
  email: string;
  role: Role;
  fullName: string;
  studentCode: string | null;
  className: string | null;
  faculty: string | null;
  avatarUrl: string | null;
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

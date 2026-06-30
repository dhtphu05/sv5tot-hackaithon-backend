import type { User } from '@prisma/client';

export type SafeUser = Pick<
  User,
  | 'id'
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
>;

export function pickSafeUser(user: User): SafeUser {
  return {
    id: user.id,
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
  };
}

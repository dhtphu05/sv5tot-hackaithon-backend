import { Role } from '@prisma/client';
import { z } from 'zod';

export const updateMeSchema = z.object({
  fullName: z.string().min(1).max(255).optional(),
  phone: z.string().min(3).max(30).nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
});

export const listUsersQuerySchema = z.object({
  role: z.nativeEnum(Role).optional(),
  faculty: z.string().min(1).optional(),
  q: z.string().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type UpdateMeInput = z.infer<typeof updateMeSchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

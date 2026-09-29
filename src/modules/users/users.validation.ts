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

const cityCriterionSchema = z.enum(['ethics', 'academic', 'physical', 'volunteer', 'integration']);

export const listAdminUsersQuerySchema = listUsersQuerySchema.extend({
  workspaceId: z.string().uuid().optional(),
  isActive: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
});

export const createAdminUserSchema = z.object({
  fullName: z.string().trim().min(1).max(255),
  email: z.string().email().transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
  phone: z.string().trim().min(3).max(30).optional(),
  role: z.nativeEnum(Role),
  workspaceId: z.string().uuid().nullable().optional(),
  studentCode: z.string().trim().min(1).max(50).transform((value) => value.toUpperCase()).optional(),
  className: z.string().trim().min(1).max(100).optional(),
  faculty: z.string().trim().min(1).max(100).optional(),
}).superRefine((value, context) => {
  if (value.role === Role.student && !value.studentCode) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Student code is required', path: ['studentCode'] });
  }
});

export const updateAdminUserSchema = z.object({
  fullName: z.string().trim().min(1).max(255).optional(),
  email: z.string().email().transform((value) => value.toLowerCase()).optional(),
  phone: z.string().trim().min(3).max(30).nullable().optional(),
  role: z.nativeEnum(Role).optional(),
  workspaceId: z.string().uuid().nullable().optional(),
  studentCode: z.string().trim().min(1).max(50).transform((value) => value.toUpperCase()).nullable().optional(),
  className: z.string().trim().min(1).max(100).nullable().optional(),
  faculty: z.string().trim().min(1).max(100).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, 'At least one editable user field is required');

export const adminUserIdParamSchema = z.object({ userId: z.string().uuid() });

export const adminUserStatusSchema = z.object({ isActive: z.boolean() });

export const adminUserResetPasswordSchema = z.object({
  newPassword: z.string().min(8).max(128),
}).strict();

export const cityOfficerSpecializationsSchema = z.object({
  criteria: z.array(cityCriterionSchema).max(5).refine((items) => new Set(items).size === items.length, 'Specializations cannot contain duplicates'),
});

export type UpdateMeInput = z.infer<typeof updateMeSchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type ListAdminUsersQuery = z.infer<typeof listAdminUsersQuerySchema>;
export type CreateAdminUserInput = z.infer<typeof createAdminUserSchema>;
export type UpdateAdminUserInput = z.infer<typeof updateAdminUserSchema>;

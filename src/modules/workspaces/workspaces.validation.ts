import { Role } from '@prisma/client';
import { z } from 'zod';

export const listWorkspacesQuerySchema = z.object({
  registration: z.coerce.boolean().optional(),
});

const optionalTrimmedString = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().optional());

const optionalNullableTrimmedString = z.preprocess((value) => {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}, z.string().nullable().optional());

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const workspaceIdParamSchema = z.object({
  workspaceId: z.string().uuid(),
});

export const listAdminWorkspacesQuerySchema = paginationQuerySchema.extend({
  search: optionalTrimmedString,
  isActive: z.coerce.boolean().optional(),
  registrationEnabled: z.coerce.boolean().optional(),
});

export const createAdminWorkspaceBodySchema = z.object({
  code: z.string().trim().min(1).max(64).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1).max(255),
  shortName: optionalNullableTrimmedString,
  isActive: z.coerce.boolean().optional(),
  registrationEnabled: z.coerce.boolean().optional(),
});

export const updateAdminWorkspaceBodySchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    shortName: optionalNullableTrimmedString,
  })
  .refine((value) => value.name !== undefined || value.shortName !== undefined, {
    message: 'At least one editable workspace field is required',
  });

export const updateAdminWorkspaceStatusBodySchema = z
  .object({
    isActive: z.coerce.boolean().optional(),
    registrationEnabled: z.coerce.boolean().optional(),
  })
  .refine((value) => value.isActive !== undefined || value.registrationEnabled !== undefined, {
    message: 'At least one status field is required',
  });

export const listAdminWorkspaceUsersQuerySchema = paginationQuerySchema.extend({
  search: optionalTrimmedString,
  role: z.nativeEnum(Role).optional(),
  isActive: z.coerce.boolean().optional(),
});

export type ListWorkspacesQuery = z.infer<typeof listWorkspacesQuerySchema>;
export type ListAdminWorkspacesQuery = z.infer<typeof listAdminWorkspacesQuerySchema>;
export type CreateAdminWorkspaceBody = z.infer<typeof createAdminWorkspaceBodySchema>;
export type UpdateAdminWorkspaceBody = z.infer<typeof updateAdminWorkspaceBodySchema>;
export type UpdateAdminWorkspaceStatusBody = z.infer<
  typeof updateAdminWorkspaceStatusBodySchema
>;
export type ListAdminWorkspaceUsersQuery = z.infer<typeof listAdminWorkspaceUsersQuerySchema>;

import { Role, WorkspaceType } from '@prisma/client';
import { z } from 'zod';

export const listWorkspacesQuerySchema = z.object({
  registration: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
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
const booleanQuerySchema = z.enum(['true', 'false']).transform((value) => value === 'true');

export const workspaceIdParamSchema = z.object({
  workspaceId: z.string().uuid(),
});

export const listAdminWorkspacesQuerySchema = paginationQuerySchema.extend({
  search: optionalTrimmedString,
  type: z.nativeEnum(WorkspaceType).optional(),
  isActive: booleanQuerySchema.optional(),
  registrationEnabled: booleanQuerySchema.optional(),
});

export const createAdminWorkspaceBodySchema = z.object({
  code: z.string().trim().min(1).max(64).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1).max(255),
  shortName: optionalNullableTrimmedString,
  isActive: z.boolean().optional(),
  registrationEnabled: z.boolean().optional(),
  type: z.nativeEnum(WorkspaceType).optional(),
  parentWorkspaceId: z.string().uuid().nullable().optional(),
});

export const updateAdminWorkspaceBodySchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    shortName: optionalNullableTrimmedString,
    parentWorkspaceId: z.string().uuid().nullable().optional(),
  })
  .refine((value) => value.name !== undefined || value.shortName !== undefined || value.parentWorkspaceId !== undefined, {
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
  isActive: booleanQuerySchema.optional(),
});

export type ListWorkspacesQuery = z.infer<typeof listWorkspacesQuerySchema>;
export type ListAdminWorkspacesQuery = z.infer<typeof listAdminWorkspacesQuerySchema>;
export type CreateAdminWorkspaceBody = z.infer<typeof createAdminWorkspaceBodySchema>;
export type UpdateAdminWorkspaceBody = z.infer<typeof updateAdminWorkspaceBodySchema>;
export type UpdateAdminWorkspaceStatusBody = z.infer<
  typeof updateAdminWorkspaceStatusBodySchema
>;
export type ListAdminWorkspaceUsersQuery = z.infer<typeof listAdminWorkspaceUsersQuerySchema>;

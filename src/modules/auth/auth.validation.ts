import { z } from 'zod';

export const registerSchema = z.object({
  fullName: z.string().trim().min(1).max(255),
  email: z
    .string()
    .email()
    .transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
  workspaceId: z.string().uuid(),
  studentCode: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .transform((value) => value.toUpperCase()),
  className: z.string().trim().min(1).max(100).optional(),
  faculty: z.string().trim().min(1).max(100).optional(),
  phone: z.string().trim().min(3).max(30).optional(),
});

export const loginSchema = z.object({
  email: z
    .string()
    .email()
    .transform((value) => value.toLowerCase()),
  password: z.string().min(8),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;

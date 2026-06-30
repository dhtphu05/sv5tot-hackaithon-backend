import { ApplicationStatus, FinalStatus, Level } from '@prisma/client';
import { z } from 'zod';

export const listManagerApplicationsQuerySchema = z.object({
  status: z.nativeEnum(ApplicationStatus).optional(),
  targetLevel: z.nativeEnum(Level).optional(),
  faculty: z.string().trim().min(1).optional(),
  schoolYear: z
    .string()
    .regex(/^\d{4}-\d{4}$/)
    .optional(),
  q: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const assignReviewTaskSchema = z.object({
  officerId: z.string().uuid(),
  note: z.string().max(1000).optional(),
});

export const finalizeApplicationSchema = z.object({
  finalStatus: z.enum([FinalStatus.passed, FinalStatus.failed, FinalStatus.partially_passed]),
  finalLevel: z.nativeEnum(Level).nullable().optional(),
  finalNote: z.string().min(1).max(3000),
  overrideAggregation: z.boolean().default(false),
  notifyStudent: z.boolean().default(true),
});

export const reopenFinalSchema = z.object({
  reason: z.string().min(1).max(2000),
  status: z
    .enum([ApplicationStatus.under_review, ApplicationStatus.supplement_required])
    .default(ApplicationStatus.under_review),
});

export type ListManagerApplicationsQuery = z.infer<typeof listManagerApplicationsQuerySchema>;
export type AssignReviewTaskInput = z.infer<typeof assignReviewTaskSchema>;
export type FinalizeApplicationInput = z.infer<typeof finalizeApplicationSchema>;
export type ReopenFinalInput = z.infer<typeof reopenFinalSchema>;

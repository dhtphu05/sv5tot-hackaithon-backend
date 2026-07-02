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

export const listManagerResultsQuerySchema = z.object({
  schoolYear: z
    .string()
    .regex(/^\d{4}-\d{4}$/)
    .optional(),
  finalStatus: z.nativeEnum(FinalStatus).optional(),
  finalLevel: z.nativeEnum(Level).optional(),
  targetLevel: z.nativeEnum(Level).optional(),
  faculty: z.string().trim().min(1).optional(),
  className: z.string().trim().min(1).optional(),
  search: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export const assignReviewTaskSchema = z
  .object({
    assignedOfficerId: z.string().uuid().optional(),
    officerId: z.string().uuid().optional(),
    reason: z.string().trim().max(1000).optional(),
    note: z.string().trim().max(1000).optional(),
    overrideSpecialization: z.boolean().default(false),
  })
  .refine((value) => value.assignedOfficerId || value.officerId, {
    message: 'assignedOfficerId is required',
    path: ['assignedOfficerId'],
  });

export const aggregateApplicationSchema = z.object({
  note: z.string().trim().max(2000).optional(),
});

export const finalizeApplicationSchema = z.object({
  finalStatus: z.enum([FinalStatus.passed, FinalStatus.failed, FinalStatus.partially_passed]),
  finalLevel: z.nativeEnum(Level).nullable().optional(),
  finalNote: z.string().min(1).max(3000),
  overrideAggregation: z.boolean().default(false),
  notifyStudent: z.boolean().default(true),
}).superRefine((value, ctx) => {
  if (
    (value.finalStatus === FinalStatus.passed ||
      value.finalStatus === FinalStatus.partially_passed) &&
    !value.finalLevel
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'finalLevel is required when finalStatus is passed or partially_passed',
      path: ['finalLevel'],
    });
  }
  if (value.finalStatus === FinalStatus.failed && value.finalLevel) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'finalLevel must be null when finalStatus is failed',
      path: ['finalLevel'],
    });
  }
});

export const reopenFinalSchema = z.object({
  reason: z.string().min(1).max(2000),
  status: z
    .enum([ApplicationStatus.under_review, ApplicationStatus.supplement_required])
    .default(ApplicationStatus.under_review),
});

export type ListManagerApplicationsQuery = z.infer<typeof listManagerApplicationsQuerySchema>;
export type ListManagerResultsQuery = z.infer<typeof listManagerResultsQuerySchema>;
export type AssignReviewTaskInput = z.infer<typeof assignReviewTaskSchema>;
export type AggregateApplicationInput = z.infer<typeof aggregateApplicationSchema>;
export type FinalizeApplicationInput = z.infer<typeof finalizeApplicationSchema>;
export type ReopenFinalInput = z.infer<typeof reopenFinalSchema>;

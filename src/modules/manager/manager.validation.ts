import { ApplicationStatus, FinalStatus, Level } from '@prisma/client';
import { z } from 'zod';

const timestampWithOffset = z.string().trim().refine((value) => {
  const hasOffset = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
  return hasOffset && Number.isFinite(Date.parse(value));
}, 'Timestamp must be valid ISO 8601 and include an explicit timezone offset');

const nullableTimestampWithOffset = timestampWithOffset.nullable();

const cityReviewSeasonFields = {
  submissionOpensAt: nullableTimestampWithOffset,
  submissionClosesAt: nullableTimestampWithOffset,
  reviewDeadlineAt: nullableTimestampWithOffset,
  supplementDeadlineAt: nullableTimestampWithOffset,
  finalizationDeadlineAt: nullableTimestampWithOffset,
};

function validateSubmissionWindowOrder(
  value: { submissionOpensAt: string | null; submissionClosesAt: string | null },
  ctx: z.RefinementCtx,
) {
  if (
    value.submissionOpensAt &&
    value.submissionClosesAt &&
    Date.parse(value.submissionOpensAt) >= Date.parse(value.submissionClosesAt)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'submissionOpensAt must be earlier than submissionClosesAt',
      path: ['submissionClosesAt'],
    });
  }
}

export const cityReviewSeasonCreateSchema = z.object({
  schoolYear: z.string().regex(/^\d{4}-\d{4}$/),
  ...cityReviewSeasonFields,
  reason: z.string().trim().min(1).max(1000),
}).superRefine(validateSubmissionWindowOrder);

export const cityReviewSeasonUpdateSchema = z.object({
  ...cityReviewSeasonFields,
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(1).max(1000),
}).superRefine(validateSubmissionWindowOrder);

export const cityReviewSeasonParamsSchema = z.object({
  schoolYear: z.string().regex(/^\d{4}-\d{4}$/),
});

export const submissionWindowExceptionSchema = z.object({
  validUntil: timestampWithOffset,
  reason: z.string().trim().min(1).max(1000),
});

export const revokeSubmissionWindowExceptionSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});

export const listManagerApplicationsQuerySchema = z.object({
  eligibilityVerification: z.enum(['pending']).optional(),
  workspaceId: z.string().uuid().optional(),
  lifecycle: z.enum(['active', 'cancelled', 'all']).default('active'),
  archive: z.enum(['exclude', 'only', 'all']).default('exclude'),
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
  workspaceId: z.string().uuid().optional(),
  lifecycle: z.enum(['active', 'cancelled', 'all']).default('active'),
  archive: z.enum(['exclude', 'only', 'all']).default('exclude'),
  schoolYear: z
    .string()
    .regex(/^\d{4}-\d{4}$/)
    .optional(),
  finalStatus: z.union([z.nativeEnum(FinalStatus), z.literal('unfinalized')]).optional(),
  finalLevel: z.nativeEnum(Level).optional(),
  status: z.nativeEnum(ApplicationStatus).optional(),
  targetLevel: z.nativeEnum(Level).optional(),
  faculty: z.string().trim().min(1).optional(),
  className: z.string().trim().min(1).optional(),
  search: z.string().trim().min(1).optional(),
  resultView: z
    .enum(['ready', 'downgraded', 'not_eligible', 'resolution', 'supplement', 'overdue', 'recently_finalized', 'unfinished'])
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(10),
  sortBy: z
    .enum([
      'lastActivityAt',
      'updatedAt',
      'newest',
      'oldest',
      'readiness_desc',
      'unfinalized_first',
      'target_level_desc',
    ])
    .default('lastActivityAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const committeeInboxQuerySchema = z.object({
  bucket: z
    .enum([
      'all',
      'ready_to_finalize',
      'downgraded',
      'no_eligible_level',
      'needs_resolution',
      'supplement_required',
      'overdue',
      'recently_finalized',
    ])
    .default('all'),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().min(1).optional(),
  targetLevel: z.enum([Level.school, Level.university, Level.city]).optional(),
  suggestedLevel: z.union([z.enum([Level.school, Level.university, Level.city]), z.literal('none')]).optional(),
  status: z.nativeEnum(ApplicationStatus).optional(),
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

export const cancelApplicationSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
});

export const reopenCancelledApplicationSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
});

export const archiveApplicationSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
});

export const unarchiveApplicationSchema = z.object({}).strict();

export type ListManagerApplicationsQuery = z.infer<typeof listManagerApplicationsQuerySchema>;
export type ListManagerResultsQuery = z.infer<typeof listManagerResultsQuerySchema>;
export type CommitteeInboxQuery = z.infer<typeof committeeInboxQuerySchema>;
export type AssignReviewTaskInput = z.infer<typeof assignReviewTaskSchema>;
export type AggregateApplicationInput = z.infer<typeof aggregateApplicationSchema>;
export type FinalizeApplicationInput = z.infer<typeof finalizeApplicationSchema>;
export type ReopenFinalInput = z.infer<typeof reopenFinalSchema>;
export type CancelApplicationInput = z.infer<typeof cancelApplicationSchema>;
export type ReopenCancelledApplicationInput = z.infer<typeof reopenCancelledApplicationSchema>;
export type ArchiveApplicationInput = z.infer<typeof archiveApplicationSchema>;
export type CityReviewSeasonCreateInput = z.infer<typeof cityReviewSeasonCreateSchema>;
export type CityReviewSeasonUpdateInput = z.infer<typeof cityReviewSeasonUpdateSchema>;
export type SubmissionWindowExceptionInput = z.infer<typeof submissionWindowExceptionSchema>;
export type RevokeSubmissionWindowExceptionInput = z.infer<typeof revokeSubmissionWindowExceptionSchema>;

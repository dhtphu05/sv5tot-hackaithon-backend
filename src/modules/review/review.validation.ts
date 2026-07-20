import { Criterion, EvidenceStatus, Level, ReviewDecision, ReviewTaskStatus } from '@prisma/client';
import { z } from 'zod';

export const listReviewTasksQuerySchema = z.object({
  status: z.nativeEnum(ReviewTaskStatus).optional(),
  criterion: z.nativeEnum(Criterion).optional(),
  targetLevel: z.nativeEnum(Level).optional(),
  faculty: z.string().trim().optional(),
  className: z.string().trim().optional(),
  search: z.string().trim().optional(),
  riskLevel: z.enum(['low', 'medium', 'high']).optional(),
  aiConfidenceMax: z.coerce.number().min(0).max(1).optional(),
  dueSoon: z.coerce.boolean().optional(),
  overdue: z.coerce.boolean().optional(),
  supplementRequired: z.coerce.boolean().optional(),
  resolutionNeeded: z.coerce.boolean().optional(),
  assignedToMe: z.coerce.boolean().optional(),
  assignedOfficerId: z.string().uuid().optional(),
  applicationId: z.string().uuid().optional(),
  q: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const ensureTasksSchema = z.object({
  mode: z.enum(['missing_only', 'all']).default('missing_only'),
});

export const evidenceDecisionSchema = z.object({
  evidenceId: z.string().uuid(),
  status: z.nativeEnum(EvidenceStatus),
  note: z.string().max(1000).optional(),
});

export const evidenceAssessmentSchema = z.object({
  evidenceId: z.string().uuid(),
  assessment: z.enum(['valid', 'invalid', 'needs_supplement', 'ambiguous']),
  note: z.string().max(1000).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).default([]),
});

export const taskDecisionSchema = z.object({
  decision: z.nativeEnum(ReviewDecision),
  officerSuggestedLevel: z.nativeEnum(Level).nullable().optional(),
  levelAssessmentJson: z.record(z.unknown()).optional(),
  supplementRequestJson: z.record(z.unknown()).optional(),
  note: z.string().max(2000).optional(),
  officerNote: z.string().max(2000).optional(),
  precedentEventId: z.string().uuid().optional(),
  precedentEvidenceId: z.string().uuid().optional(),
  precedentId: z.string().uuid().optional(),
  evidenceDecisions: z.array(evidenceDecisionSchema).default([]),
  evidenceAssessments: z.array(evidenceAssessmentSchema).default([]),
});

export const requestSupplementSchema = z.object({
  reason: z.string().min(1).max(2000),
  requestedEvidenceName: z.string().max(255).optional(),
  allowedCriteria: z.array(z.nativeEnum(Criterion)).optional(),
  evidenceIds: z.array(z.string().uuid()).default([]),
  requestedFields: z.array(z.string().trim().min(1).max(100)).default([]),
  deadline: z.string().datetime().optional(),
});

export const escalateResolutionSchema = z
  .object({
    reason: z.string().min(1).max(2000),
    evidenceId: z.string().uuid().optional(),
    evidenceIds: z.array(z.string().uuid()).default([]),
    precedentGuardViewed: z.boolean().optional(),
    precedentGuardReason: z
      .enum(['different_level', 'different_organizer', 'conflicting_information', 'other'])
      .optional(),
    precedentId: z.string().uuid().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.precedentGuardViewed && value.precedentId && !value.precedentGuardReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['precedentGuardReason'],
        message: 'precedentGuardReason is required when continuing after viewing a precedent',
      });
    }
  });

export const reviewTaskPrecedentCheckQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(10).default(3),
});

export type ListReviewTasksQuery = z.infer<typeof listReviewTasksQuerySchema>;
export type TaskDecisionInput = z.infer<typeof taskDecisionSchema>;
export type RequestSupplementInput = z.infer<typeof requestSupplementSchema>;
export type EscalateResolutionInput = z.infer<typeof escalateResolutionSchema>;
export type ReviewTaskPrecedentCheckQuery = z.infer<typeof reviewTaskPrecedentCheckQuerySchema>;

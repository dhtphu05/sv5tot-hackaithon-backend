import { Criterion, EvidenceStatus, ReviewDecision, ReviewTaskStatus } from '@prisma/client';
import { z } from 'zod';

export const listReviewTasksQuerySchema = z.object({
  status: z.nativeEnum(ReviewTaskStatus).optional(),
  criterion: z.nativeEnum(Criterion).optional(),
  assignedToMe: z.coerce.boolean().optional(),
  applicationId: z.string().uuid().optional(),
  q: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const evidenceDecisionSchema = z.object({
  evidenceId: z.string().uuid(),
  status: z.nativeEnum(EvidenceStatus),
  note: z.string().max(1000).optional(),
});

export const taskDecisionSchema = z.object({
  decision: z.nativeEnum(ReviewDecision),
  officerNote: z.string().max(2000).optional(),
  evidenceDecisions: z.array(evidenceDecisionSchema).default([]),
});

export const requestSupplementSchema = z.object({
  reason: z.string().min(1).max(2000),
  requestedEvidenceName: z.string().max(255).optional(),
  allowedCriteria: z.array(z.nativeEnum(Criterion)).optional(),
  deadline: z.string().datetime().optional(),
});

export const escalateResolutionSchema = z.object({
  reason: z.string().min(1).max(2000),
  evidenceId: z.string().uuid().optional(),
});

export type ListReviewTasksQuery = z.infer<typeof listReviewTasksQuerySchema>;
export type TaskDecisionInput = z.infer<typeof taskDecisionSchema>;
export type RequestSupplementInput = z.infer<typeof requestSupplementSchema>;
export type EscalateResolutionInput = z.infer<typeof escalateResolutionSchema>;

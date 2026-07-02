// Owns committee resolution cases and final dispute decisions validation.
import { Criterion } from '@prisma/client';
import { z } from 'zod';

export const resolutionStatusQuerySchema = z.enum([
  'open',
  'analyzing',
  'committee_review',
  'in_review',
  'resolved',
  'closed',
  'rejected',
]);

export const resolutionPrioritySchema = z.enum(['low', 'normal', 'high']);

export const resolutionFinalDecisionSchema = z.enum([
  'accepted',
  'rejected',
  'supplement_required',
  'closed_no_action',
]);

export const listResolutionCasesQuerySchema = z.object({
  status: resolutionStatusQuerySchema.optional(),
  criterion: z.nativeEnum(Criterion).optional(),
  priority: resolutionPrioritySchema.optional(),
  applicationId: z.string().uuid().optional(),
  evidenceId: z.string().uuid().optional(),
  q: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const evidenceResolutionDecisionSchema = z.object({
  evidenceId: z.string().uuid(),
  decision: resolutionFinalDecisionSchema.exclude(['closed_no_action']),
  note: z.string().trim().max(1000).optional(),
});

export const resolutionDecisionSchema = z.object({
  decision: resolutionFinalDecisionSchema,
  note: z.string().trim().min(1).max(2000),
  updateKnowledgeBase: z.boolean().default(false),
  knowledgeBaseTitle: z.string().trim().max(255).optional(),
  evidenceDecisions: z.array(evidenceResolutionDecisionSchema).default([]),
});

export const resolutionStatusUpdateSchema = z.object({
  status: resolutionStatusQuerySchema,
  note: z.string().trim().max(2000).optional(),
});

export const reopenResolutionCaseSchema = z.object({
  reason: z.string().min(1).max(2000),
});

export type ListResolutionCasesQuery = z.infer<typeof listResolutionCasesQuerySchema>;
export type ResolutionDecisionInput = z.infer<typeof resolutionDecisionSchema>;
export type ResolutionStatusUpdateInput = z.infer<typeof resolutionStatusUpdateSchema>;
export type ReopenResolutionCaseInput = z.infer<typeof reopenResolutionCaseSchema>;

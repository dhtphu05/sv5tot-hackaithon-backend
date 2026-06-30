// Owns committee resolution cases and final dispute decisions validation.
import { Criterion, KnowledgeDecision, ResolutionStatus } from '@prisma/client';
import { z } from 'zod';

export const listResolutionCasesQuerySchema = z.object({
  status: z.nativeEnum(ResolutionStatus).optional(),
  criterion: z.nativeEnum(Criterion).optional(),
  applicationId: z.string().uuid().optional(),
  evidenceId: z.string().uuid().optional(),
  q: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const resolutionDecisionSchema = z.object({
  decision: z.nativeEnum(KnowledgeDecision),
  committeeNote: z.string().min(1).max(2000),
  updateRelatedTask: z.boolean().default(true),
  saveToKnowledgeBase: z.boolean().default(false),
  knowledgeBase: z
    .object({
      decision: z.nativeEnum(KnowledgeDecision),
      reason: z.string().min(1).max(2000),
      requiredFields: z.array(z.string()).default([]),
      commonErrors: z.array(z.string()).default([]),
    })
    .optional(),
});

export const reopenResolutionCaseSchema = z.object({
  reason: z.string().min(1).max(2000),
});

export type ListResolutionCasesQuery = z.infer<typeof listResolutionCasesQuerySchema>;
export type ResolutionDecisionInput = z.infer<typeof resolutionDecisionSchema>;
export type ReopenResolutionCaseInput = z.infer<typeof reopenResolutionCaseSchema>;

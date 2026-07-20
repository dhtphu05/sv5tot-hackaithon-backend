import { Criterion, Level } from '@prisma/client';
import { z } from 'zod';

export const knowledgeBaseSearchQuerySchema = z.object({
  q: z.string().optional(),
  criterion: z.nativeEnum(Criterion).optional(),
  level: z.nativeEnum(Level).optional(),
  decision: z.enum(['accepted', 'rejected', 'needs_supplement', 'resolution_needed', 'reference_only']).optional(),
  sourceType: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const approvedEvidenceNamesQuerySchema = z.object({
  q: z.string().trim().optional(),
  criterion: z.nativeEnum(Criterion).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const createFromReviewedEvidenceSchema = z.object({
  evidenceId: z.string().uuid(),
  decision: z.enum(['accepted', 'rejected', 'needs_supplement', 'resolution_needed', 'reference_only']),
  title: z.string().trim().min(1).optional(),
  summary: z.string().trim().optional(),
  tags: z.array(z.string()).default([]),
  reusable: z.boolean().default(true),

  // compatibility fields for existing schema
  reason: z.string().min(1).max(2000).optional(),
  level: z.nativeEnum(Level).optional(),
  requiredFields: z.array(z.string()).default([]),
  commonErrors: z.array(z.string()).default([]),
  anonymize: z.boolean().default(true),
});

export const updateKnowledgeBaseItemSchema = z.object({
  reason: z.string().max(2000).optional(),
  requiredFields: z.array(z.string()).optional(),
  commonErrors: z.array(z.string()).optional(),
  decision: z.enum(['accepted', 'rejected', 'needs_supplement', 'resolution_needed', 'reference_only']).optional(),
  level: z.nativeEnum(Level).nullable().optional(),
  evidenceName: z.string().max(255).nullable().optional(),
  eventName: z.string().max(255).nullable().optional(),
});

export type KnowledgeBaseSearchQuery = z.infer<typeof knowledgeBaseSearchQuerySchema>;
export type ApprovedEvidenceNamesQuery = z.infer<typeof approvedEvidenceNamesQuerySchema>;
export type CreateFromReviewedEvidenceInput = z.infer<typeof createFromReviewedEvidenceSchema>;
export type UpdateKnowledgeBaseItemInput = z.infer<typeof updateKnowledgeBaseItemSchema>;

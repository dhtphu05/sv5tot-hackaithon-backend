import { Criterion, Level } from '@prisma/client';
import { z } from 'zod';

export const evidenceKnowledgeOfficerSearchQuerySchema = z.object({
  q: z.string().trim().max(255).optional(),
  criterion: z.nativeEnum(Criterion).optional(),
  applicationId: z.string().uuid().optional(),
  year: z.coerce.number().int().min(1900).max(2100).optional(),
  level: z.nativeEnum(Level).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const evidenceKnowledgeEventParamsSchema = z.object({
  eventId: z.string().uuid(),
});

export const reviewTaskPrecedentCheckQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(10).default(3),
});

export const precedentGuardReasonSchema = z.enum([
  'different_level',
  'different_organizer',
  'conflicting_information',
  'other',
]);

export type EvidenceKnowledgeOfficerSearchQuery = z.infer<
  typeof evidenceKnowledgeOfficerSearchQuerySchema
>;
export type ReviewTaskPrecedentCheckQuery = z.infer<typeof reviewTaskPrecedentCheckQuerySchema>;

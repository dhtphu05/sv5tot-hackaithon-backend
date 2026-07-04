import { Criterion } from '@prisma/client';
import { z } from 'zod';

export const evidenceMatchingSearchQuerySchema = z.object({
  studentCode: z.string().trim().optional(),
  criterion: z.nativeEnum(Criterion).optional(),
  q: z.string().trim().optional(),
  applicationId: z.string().uuid().optional(),
  track: z.coerce.boolean().default(false),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(20).default(5),
});

export const importEvidenceMatchingSchema = z.object({
  applicationId: z.string().uuid(),
  participantId: z.string().uuid().optional(),
  evidenceName: z.string().trim().min(3).max(255).optional(),
  note: z.string().trim().optional(),
});

export type EvidenceMatchingSearchQuery = z.infer<typeof evidenceMatchingSearchQuerySchema>;
export type ImportEvidenceMatchingInput = z.infer<typeof importEvidenceMatchingSchema>;

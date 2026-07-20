import { Criterion, EvidenceSourceType, EvidenceStatus, IndexingStatus } from '@prisma/client';
import { z } from 'zod';

export const listEvidencesQuerySchema = z.object({
  criterion: z.nativeEnum(Criterion).optional(),
  status: z.nativeEnum(EvidenceStatus).optional(),
  indexingStatus: z.nativeEnum(IndexingStatus).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const createEvidenceSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return {
    ...record,
    evidenceName: record.evidenceName ?? record.evidence_name,
    sourceType: record.sourceType ?? record.source_type ?? EvidenceSourceType.manual_upload,
  };
}, z.object({
  evidenceName: z.string().trim().min(1).max(255),
  criterion: z.nativeEnum(Criterion),
  sourceType: z.nativeEnum(EvidenceSourceType).default(EvidenceSourceType.manual_upload),
  description: z.string().trim().optional(),
  metadata: z.record(z.any()).optional(),
  eventId: z.string().uuid().optional(),
}));

export const updateEvidenceSchema = z.object({
  evidenceName: z.string().trim().min(3).max(255).optional(),
  criterion: z.nativeEnum(Criterion).optional(),
});

export const startIndexingSchema = z.object({
  force: z.boolean().default(false),
  runMode: z.enum(['sync', 'async']).default('async'),
});

export const saveEvidenceCardCorrectionsSchema = z.object({
  fields: z.record(z.unknown()),
  expectedUpdatedAt: z.string().datetime().optional(),
});

export const confirmEvidenceCardSchema = z.object({
  acknowledgedWarnings: z.array(z.string().trim().min(1)).optional(),
  expectedUpdatedAt: z.string().datetime().optional(),
});

export type ListEvidencesQuery = z.infer<typeof listEvidencesQuerySchema>;
export type CreateEvidenceInput = z.infer<typeof createEvidenceSchema>;
export type UpdateEvidenceInput = z.infer<typeof updateEvidenceSchema>;
export type StartIndexingInput = z.infer<typeof startIndexingSchema>;
export type SaveEvidenceCardCorrectionsInput = z.infer<typeof saveEvidenceCardCorrectionsSchema>;
export type ConfirmEvidenceCardInput = z.infer<typeof confirmEvidenceCardSchema>;

import { AwardDecisionStatus } from '@prisma/client';
import { z } from 'zod';

const optionalDate = z.preprocess(
  (value) => {
    if (value === '' || value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
      return `${value.trim()}T00:00:00.000Z`;
    }
    return value;
  },
  z.string().datetime().nullable().optional(),
);

const decisionNumber = z.preprocess(
  (value) => (typeof value === 'string' && !value.trim() ? null : value),
  z.string().trim().max(120).nullable().optional(),
);

export const listAwardDecisionsQuerySchema = z.object({
  q: z.string().trim().optional(),
  schoolYear: z.string().trim().optional(),
  status: z.nativeEnum(AwardDecisionStatus).optional(),
  issuerWorkspaceId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const createAwardDecisionSchema = z
  .object({
    issuerWorkspaceId: z.string().uuid().optional(),
    schoolYear: z.string().trim().min(1).max(20),
    decisionNumber,
    decisionDate: optionalDate,
  })
  .strict();

export const updateAwardDecisionSchema = z
  .object({
    schoolYear: z.string().trim().min(1).max(20).optional(),
    decisionNumber,
    decisionDate: optionalDate,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field must be provided');

export type ListAwardDecisionsQuery = z.infer<typeof listAwardDecisionsQuerySchema>;
export type CreateAwardDecisionInput = z.infer<typeof createAwardDecisionSchema>;
export type UpdateAwardDecisionInput = z.infer<typeof updateAwardDecisionSchema>;

import { Criterion, Level } from '@prisma/client';
import { z } from 'zod';

const csvScopesSchema = z
  .string()
  .optional()
  .transform((value) =>
    value
      ? value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : [],
  )
  .pipe(z.array(z.nativeEnum(Level)).max(4));

export const activeCriteriaQuerySchema = z.object({
  scope: z.nativeEnum(Level).optional(),
  criterion: z.nativeEnum(Criterion).optional(),
});

export const criteriaEvaluationQuerySchema = z.object({
  scope: z.nativeEnum(Level),
  criterion: z.nativeEnum(Criterion).optional(),
});

export const criteriaGapQuerySchema = z.object({
  scopes: csvScopesSchema.optional(),
  criterion: z.nativeEnum(Criterion).optional(),
});

export type ActiveCriteriaQuery = z.infer<typeof activeCriteriaQuerySchema>;
export type CriteriaEvaluationQuery = z.infer<typeof criteriaEvaluationQuerySchema>;
export type CriteriaGapQuery = z.infer<typeof criteriaGapQuerySchema>;

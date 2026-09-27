import {
  ApplicationStatus,
  Criterion,
  FinalStatus,
  ReviewTaskStatus,
} from '@prisma/client';
import { z } from 'zod';

const cityCriterionSchema = z.enum([
  Criterion.ethics,
  Criterion.academic,
  Criterion.physical,
  Criterion.volunteer,
  Criterion.integration,
]);

export const cityAnalyticsQuerySchema = z.object({
  schoolYear: z.string().regex(/^\d{4}-\d{4}$/).optional(),
  workspaceId: z.string().uuid().optional(),
  status: z.nativeEnum(ApplicationStatus).optional(),
});

export const cityAnalyticsApplicationsQuerySchema = cityAnalyticsQuerySchema.extend({
  criterion: cityCriterionSchema.optional(),
  taskStatus: z.nativeEnum(ReviewTaskStatus).optional(),
  finalStatus: z.nativeEnum(FinalStatus).optional(),
  submitted: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  inReview: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  supplementRequired: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  resolutionBlocked: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  q: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type CityAnalyticsQuery = z.infer<typeof cityAnalyticsQuerySchema>;
export type CityAnalyticsApplicationsQuery = z.infer<typeof cityAnalyticsApplicationsQuerySchema>;

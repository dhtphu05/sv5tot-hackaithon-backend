// Owns export job requests for applications and review results validation.
import { ApplicationStatus, Criterion, Level } from '@prisma/client';
import { z } from 'zod';

const exportBaseQuerySchema = z.object({
  schoolYear: z
    .string()
    .regex(/^\d{4}-\d{4}$/)
    .optional(),
  status: z.nativeEnum(ApplicationStatus).optional(),
  targetLevel: z.nativeEnum(Level).optional(),
  faculty: z.string().min(1).optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

export const exportApplicationsQuerySchema = exportBaseQuerySchema;

export const exportReviewTasksQuerySchema = exportBaseQuerySchema.extend({
  criterion: z.nativeEnum(Criterion).optional(),
});

export const exportReviewResultsSchema = exportBaseQuerySchema.extend({
  format: z.enum(['json', 'csv']).default('json'),
});

export type ExportApplicationsQuery = z.infer<typeof exportApplicationsQuerySchema>;
export type ExportReviewTasksQuery = z.infer<typeof exportReviewTasksQuerySchema>;
export type ExportReviewResultsInput = z.infer<typeof exportReviewResultsSchema>;

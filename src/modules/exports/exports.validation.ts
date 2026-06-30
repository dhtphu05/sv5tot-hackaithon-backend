// Owns export job requests for applications and review results validation.
import { ApplicationStatus, Level } from '@prisma/client';
import { z } from 'zod';

export const exportReviewResultsSchema = z.object({
  schoolYear: z
    .string()
    .regex(/^\d{4}-\d{4}$/)
    .optional(),
  status: z.nativeEnum(ApplicationStatus).optional(),
  targetLevel: z.nativeEnum(Level).optional(),
  faculty: z.string().min(1).optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

export type ExportReviewResultsInput = z.infer<typeof exportReviewResultsSchema>;

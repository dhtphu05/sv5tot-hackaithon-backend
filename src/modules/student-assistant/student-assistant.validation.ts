import { Criterion } from '@prisma/client';
import { z } from 'zod';

const contextTypeSchema = z.enum([
  'dashboard',
  'evidence_card',
  'precheck',
  'event_registry',
  'supplement',
]);

export const studentAssistantContextQuerySchema = z.object({
  contextType: contextTypeSchema,
  contextId: z.string().uuid().optional(),
  applicationId: z.string().uuid().optional(),
  criterion: z.nativeEnum(Criterion).optional(),
  evidenceId: z.string().uuid().optional(),
  eventId: z.string().uuid().optional(),
  reviewTaskId: z.string().uuid().optional(),
  schoolYear: z
    .string()
    .regex(/^\d{4}-\d{4}$/)
    .optional(),
});

export const studentAssistantStreamSchema = studentAssistantContextQuerySchema.extend({
  contextVersion: z.string().min(8).max(128),
  message: z.string().trim().min(1).max(600),
  recentMessages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(600),
      }),
    )
    .max(6)
    .optional(),
});

export const supplementResubmitSchema = z.object({
  contextVersion: z.string().min(8).max(128).optional(),
});

export type StudentAssistantContextQueryInput = z.infer<typeof studentAssistantContextQuerySchema>;
export type StudentAssistantStreamSchemaInput = z.infer<typeof studentAssistantStreamSchema>;

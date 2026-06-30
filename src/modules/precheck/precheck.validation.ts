import { Level } from '@prisma/client';
import { z } from 'zod';

export const runPrecheckSchema = z.object({
  level: z.nativeEnum(Level).optional(),
  runMode: z.literal('sync').optional(),
});

export type RunPrecheckInput = z.infer<typeof runPrecheckSchema>;

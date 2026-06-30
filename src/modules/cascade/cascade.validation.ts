import { z } from 'zod';

export const runCascadeReviewSchema = z.object({
  includeUpgradeHints: z.boolean().default(false),
});

export type RunCascadeReviewInput = z.infer<typeof runCascadeReviewSchema>;

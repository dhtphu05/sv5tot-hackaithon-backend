import { z } from 'zod';
import type { AiEvaluationSample } from './ai-evaluation';

const rowSchema = z.record(z.string(), z.unknown());
const sampleSchema = z
  .object({
    useCase: z.string().min(1),
    expectedFields: z.record(z.string(), z.unknown()).optional(),
    actualFields: z.record(z.string(), z.unknown()).optional(),
    expectedRows: z.array(rowSchema).optional(),
    actualRows: z.array(rowSchema).optional(),
    documentSuccess: z.boolean(),
    latencyMs: z.number().finite().nonnegative().optional(),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
    retries: z.number().int().nonnegative(),
    humanCorrectedRows: z.number().int().nonnegative(),
    extractedRows: z.number().int().nonnegative(),
  })
  .strict();

const datasetSchema = z
  .object({
    provenance: z.literal('synthetic_fixture_predictions_not_model_outputs'),
    samples: z.array(sampleSchema),
  })
  .strict();

export type AiEvaluationDataset = {
  provenance: 'synthetic_fixture_predictions_not_model_outputs';
  samples: AiEvaluationSample[];
};

export function parseAiEvaluationDataset(input: unknown): AiEvaluationDataset {
  return datasetSchema.parse(input) as AiEvaluationDataset;
}

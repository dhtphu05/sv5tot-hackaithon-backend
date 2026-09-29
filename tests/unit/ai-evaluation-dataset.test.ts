import { describe, expect, it } from 'vitest';
import { parseAiEvaluationDataset } from '../../src/modules/ai/ai-evaluation-dataset';

describe('AI evaluation dataset', () => {
  it('accepts explicitly synthetic predictions and leaves unavailable runtime metrics absent', () => {
    const dataset = parseAiEvaluationDataset({
      provenance: 'synthetic_fixture_predictions_not_model_outputs',
      samples: [
        {
          useCase: 'evidence',
          expectedFields: { studentCode: 'SYN-0001' },
          actualFields: { studentCode: 'SYN-0001' },
          documentSuccess: true,
          retries: 0,
          humanCorrectedRows: 0,
          extractedRows: 0,
        },
      ],
    });

    expect(dataset.samples[0]?.latencyMs).toBeUndefined();
    expect(dataset.samples[0]?.totalTokens).toBeUndefined();
  });

  it('rejects datasets that could be mistaken for model output', () => {
    expect(() =>
      parseAiEvaluationDataset({
        provenance: 'openai',
        samples: [],
      }),
    ).toThrow();
  });

  it('rejects malformed metric observations', () => {
    expect(() =>
      parseAiEvaluationDataset({
        provenance: 'synthetic_fixture_predictions_not_model_outputs',
        samples: [{ useCase: 'evidence', documentSuccess: true, retries: -1 }],
      }),
    ).toThrow();
  });
});

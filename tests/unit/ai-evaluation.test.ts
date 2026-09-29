import { describe, expect, it } from 'vitest';
import { scoreAiEvaluation } from '../../src/modules/ai/ai-evaluation';

describe('AI evaluation scorer', () => {
  it('reports field, row, document, correction, latency, token, retry and failure metrics', () => {
    const result = scoreAiEvaluation([
      {
        useCase: 'evidence',
        expectedFields: { documentType: 'certificate', studentCode: '00123456', issueDate: '2026-01-02' },
        actualFields: { documentType: 'certificate', studentCode: '123456', issueDate: '2026-01-02' },
        documentSuccess: true,
        latencyMs: 10,
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        retries: 1,
        humanCorrectedRows: 0,
        extractedRows: 0,
      },
      {
        useCase: 'event_roster',
        expectedFields: { columns: ['studentCode', 'studentName'] },
        actualFields: { columns: ['studentCode', 'studentName'] },
        expectedRows: [
          { studentCode: '00123456', studentName: 'Synthetic One' },
          { studentCode: '00987654', studentName: 'Synthetic Two' },
        ],
        actualRows: [
          { studentCode: '00123456', studentName: 'Synthetic One' },
          { studentCode: '00987654', studentName: 'Synthetic Wrong' },
        ],
        documentSuccess: false,
        latencyMs: 30,
        inputTokens: 300,
        outputTokens: 60,
        totalTokens: 360,
        retries: 0,
        humanCorrectedRows: 1,
        extractedRows: 2,
      },
    ]);

    expect(result).toEqual({
      sampleCount: 2,
      fieldCount: 4,
      fieldAccuracy: 0.75,
      expectedRowCount: 2,
      predictedRowCount: 2,
      matchedRowCount: 1,
      rowPrecision: 0.5,
      rowRecall: 0.5,
      documentSuccessRate: 0.5,
      humanCorrectionRate: 0.5,
      latencyP50Ms: 20,
      latencyP95Ms: 29,
      averageInputTokens: 200,
      averageOutputTokens: 40,
      averageTotalTokens: 240,
      retryRate: 0.5,
      failureRate: 0.5,
    });
  });

  it('returns null for metrics with no applicable observations', () => {
    expect(scoreAiEvaluation([])).toEqual({
      sampleCount: 0,
      fieldCount: 0,
      fieldAccuracy: null,
      expectedRowCount: 0,
      predictedRowCount: 0,
      matchedRowCount: 0,
      rowPrecision: null,
      rowRecall: null,
      documentSuccessRate: null,
      humanCorrectionRate: null,
      latencyP50Ms: null,
      latencyP95Ms: null,
      averageInputTokens: null,
      averageOutputTokens: null,
      averageTotalTokens: null,
      retryRate: null,
      failureRate: null,
    });
  });
});

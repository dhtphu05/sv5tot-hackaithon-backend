export type AiEvaluationSample = {
  useCase: string;
  expectedFields?: Record<string, unknown>;
  actualFields?: Record<string, unknown>;
  expectedRows?: Array<Record<string, unknown>>;
  actualRows?: Array<Record<string, unknown>>;
  documentSuccess: boolean;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  retries: number;
  humanCorrectedRows: number;
  extractedRows: number;
};

export type AiEvaluationMetrics = {
  sampleCount: number;
  fieldCount: number;
  fieldAccuracy: number | null;
  expectedRowCount: number;
  predictedRowCount: number;
  matchedRowCount: number;
  rowPrecision: number | null;
  rowRecall: number | null;
  documentSuccessRate: number | null;
  humanCorrectionRate: number | null;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  averageInputTokens: number | null;
  averageOutputTokens: number | null;
  averageTotalTokens: number | null;
  retryRate: number | null;
  failureRate: number | null;
};

export function scoreAiEvaluation(samples: readonly AiEvaluationSample[]): AiEvaluationMetrics {
  const expectedRows = samples.flatMap((sample) => sample.expectedRows ?? []);
  const predictedRows = samples.flatMap((sample) => sample.actualRows ?? []);
  const matchedRowCount = countMatchingRows(expectedRows, predictedRows);
  const fields = samples.flatMap((sample) =>
    Object.entries(sample.expectedFields ?? {}).map(([key, expected]) => ({
      expected,
      actual: sample.actualFields?.[key],
    })),
  );
  const latencySamples = samples.flatMap((sample) =>
    isNonNegativeFiniteNumber(sample.latencyMs) ? [sample.latencyMs] : [],
  );
  const extractedRows = samples.reduce((sum, sample) => sum + Math.max(0, sample.extractedRows), 0);
  const correctedRows = samples.reduce((sum, sample) => sum + Math.max(0, sample.humanCorrectedRows), 0);
  const successCount = samples.filter((sample) => sample.documentSuccess).length;

  return {
    sampleCount: samples.length,
    fieldCount: fields.length,
    fieldAccuracy: ratio(fields.filter(({ expected, actual }) => stableValue(expected) === stableValue(actual)).length, fields.length),
    expectedRowCount: expectedRows.length,
    predictedRowCount: predictedRows.length,
    matchedRowCount,
    rowPrecision: ratio(matchedRowCount, predictedRows.length),
    rowRecall: ratio(matchedRowCount, expectedRows.length),
    documentSuccessRate: ratio(successCount, samples.length),
    humanCorrectionRate: ratio(correctedRows, extractedRows),
    latencyP50Ms: percentile(latencySamples, 0.5),
    latencyP95Ms: percentile(latencySamples, 0.95),
    averageInputTokens: average(samples.map((sample) => sample.inputTokens)),
    averageOutputTokens: average(samples.map((sample) => sample.outputTokens)),
    averageTotalTokens: average(samples.map((sample) => sample.totalTokens)),
    retryRate: ratio(samples.filter((sample) => sample.retries > 0).length, samples.length),
    failureRate: ratio(samples.filter((sample) => !sample.documentSuccess).length, samples.length),
  };
}

function countMatchingRows(expected: Array<Record<string, unknown>>, actual: Array<Record<string, unknown>>) {
  const remaining = new Map<string, number>();
  for (const row of expected) {
    const key = stableValue(row);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }

  let matched = 0;
  for (const row of actual) {
    const key = stableValue(row);
    const count = remaining.get(key) ?? 0;
    if (count === 0) continue;
    matched += 1;
    remaining.set(key, count - 1);
  }
  return matched;
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableValue(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : round(numerator / denominator);
}

function average(values: Array<number | undefined>): number | null {
  const observed = values.filter(isNonNegativeFiniteNumber);
  if (observed.length === 0) return null;
  return round(observed.reduce((sum, value) => sum + value, 0) / observed.length);
}

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * quantile;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const interpolation = index - lowerIndex;
  return round(sorted[lowerIndex]! + (sorted[upperIndex]! - sorted[lowerIndex]!) * interpolation);
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

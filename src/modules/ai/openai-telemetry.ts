import { logger } from '../../config/logger';

export type OpenAiTelemetryInput = {
  useCase: string;
  model: string;
  promptVersion: string;
  requestId: string;
  entityType?: string;
  entityRef?: string;
  startedAtMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  attempts: number;
  retries: number;
  outcome: 'success' | 'failure';
  errorCode?: string;
};

export function logOpenAiTelemetry(input: OpenAiTelemetryInput) {
  const telemetry = {
    provider: 'openai' as const,
    useCase: input.useCase,
    model: input.model,
    promptVersion: input.promptVersion,
    requestId: input.requestId,
    entityType: input.entityType,
    entityRef: input.entityRef,
    startedAt: new Date(input.startedAtMs).toISOString(),
    endedAt: new Date().toISOString(),
    latencyMs: Date.now() - input.startedAtMs,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    totalTokens: input.totalTokens,
    attempts: input.attempts,
    retries: input.retries,
    outcome: input.outcome,
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
  };

  if (input.outcome === 'success') {
    logger.info(telemetry, 'OpenAI request completed');
  } else {
    logger.warn(telemetry, 'OpenAI request failed');
  }

  return telemetry;
}

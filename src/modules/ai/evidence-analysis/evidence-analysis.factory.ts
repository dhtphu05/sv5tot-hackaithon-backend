import { env } from '../../../config/env';
import { AppError } from '../../../shared/errors/app-error';
import { ErrorCodes } from '../../../shared/errors/error-codes';
import { MockEvidenceAnalysisAdapter } from './mock-evidence-analysis.adapter';
import { OpenAiEvidenceAnalysisAdapter } from './openai-evidence-analysis.adapter';
import { SmartReaderEvidenceAnalysisAdapter } from './smartreader-evidence-analysis.adapter';
import type { EvidenceAnalysisProvider, EvidenceAnalysisRuntimeConfig } from './evidence-analysis.types';

export function createEvidenceAnalysisProvider(
  config: EvidenceAnalysisRuntimeConfig = {},
): EvidenceAnalysisProvider {
  const provider = config.provider ?? 'openai';
  if (provider === 'mock') return new MockEvidenceAnalysisAdapter();
  if (provider === 'smartreader') return new SmartReaderEvidenceAnalysisAdapter();

  const apiKey = config.openaiApiKey ?? env.OPENAI_API_KEY;
  const model = config.openaiModel ?? env.OPENAI_EVIDENCE_MODEL;
  if (!apiKey || !model) {
    throw new AppError(
      500,
      ErrorCodes.OPENAI_NOT_CONFIGURED,
      'OpenAI evidence analysis is not configured',
      { retryable: false },
    );
  }

  return new OpenAiEvidenceAnalysisAdapter({
    apiKey,
    model,
    timeoutMs: config.openaiTimeoutMs ?? env.OPENAI_EVIDENCE_TIMEOUT_MS,
    maxRetries: config.openaiMaxRetries ?? env.OPENAI_EVIDENCE_MAX_RETRIES,
    storeResponses: config.openaiStoreResponses ?? env.OPENAI_STORE_RESPONSES,
    promptVersion: config.openaiPromptVersion ?? env.OPENAI_EVIDENCE_PROMPT_VERSION,
  });
}

export function getConfiguredEvidenceAnalysisProvider() {
  return createEvidenceAnalysisProvider({
    provider: env.EVIDENCE_ANALYSIS_PROVIDER,
  });
}

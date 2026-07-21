import OpenAI from 'openai';
import { env } from '../../config/env';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes, type ErrorCode } from '../../shared/errors/error-codes';
import { hmacSha256 } from '../../shared/utils/hash';

let openAiClient: OpenAI | null = null;

export function getOpenAiClient(): OpenAI {
  if (!env.OPENAI_API_KEY) {
    throw new AppError(500, ErrorCodes.OPENAI_NOT_CONFIGURED, 'OPENAI_API_KEY is required for OpenAI provider', {
      retryable: false,
    });
  }
  if (!openAiClient) {
    openAiClient = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  return openAiClient;
}

export function buildOpenAiSafetyIdentifier(scope: string, internalId?: string | null) {
  if (!internalId) return undefined;
  const secret = env.JWT_ACCESS_SECRET || env.JWT_REFRESH_SECRET;
  return `${scope}_${hmacSha256(internalId, secret).slice(0, 32)}`;
}

export function mapOpenAiRuntimeError(
  error: unknown,
  fallbackCode: ErrorCode = ErrorCodes.OPENAI_PROVIDER_ERROR,
): ErrorCode {
  const record = asRecord(error);
  const status = typeof record?.status === 'number' ? record.status : undefined;
  const name = typeof record?.name === 'string' ? record.name : '';
  const code = typeof record?.code === 'string' ? record.code : '';
  const message = typeof record?.message === 'string' ? record.message.toLowerCase() : '';
  if (name === 'AbortError') return ErrorCodes.OPENAI_REQUEST_ABORTED;
  if (code.includes('timeout') || message.includes('timeout')) return ErrorCodes.OPENAI_TIMEOUT;
  if (status === 401 || status === 403) return ErrorCodes.OPENAI_AUTHENTICATION_FAILED;
  if (status === 404 || message.includes('model')) return ErrorCodes.OPENAI_MODEL_NOT_AVAILABLE;
  if (status === 429) {
    return message.includes('quota') || message.includes('billing')
      ? ErrorCodes.OPENAI_QUOTA_EXCEEDED
      : ErrorCodes.OPENAI_RATE_LIMITED;
  }
  if (status === 400) return ErrorCodes.OPENAI_INVALID_REQUEST;
  if (code === 'ECONNRESET' || code === 'ENOTFOUND' || code === 'ETIMEDOUT') {
    return ErrorCodes.OPENAI_NETWORK_ERROR;
  }
  return fallbackCode;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

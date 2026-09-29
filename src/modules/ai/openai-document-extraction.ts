import { randomUUID } from 'node:crypto';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import { buildOpenAiSafetyIdentifier, getOpenAiClient, mapOpenAiRuntimeError } from './openai-client';

export type DocumentExtractionContent =
  | { type: 'input_text'; text: string }
  | { type: 'input_file'; filename: string; file_data: string }
  | { type: 'input_image'; image_url: string; detail: 'auto' | 'low' | 'high' };

type ExtractionInput<T> = {
  useCase: string;
  model: string;
  promptVersion: string;
  instructions: string;
  schemaName: string;
  outputSchema: Record<string, unknown>;
  validate: (value: unknown) => T;
  content: DocumentExtractionContent[];
  timeoutMs: number;
  maxRetries: number;
  entity?: { type: string; id: string };
  maxOutputTokens?: number;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  storeResponses?: boolean;
};

export type DocumentExtractionClient = {
  responses: {
    create(
      params: Record<string, unknown>,
      options: { timeout: number; maxRetries: 0 },
    ): Promise<unknown>;
  };
};

export type DocumentExtractionTelemetry = {
  provider: 'openai';
  useCase: string;
  model: string;
  promptVersion: string;
  requestId: string;
  entityType?: string;
  entityRef?: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  attempts: number;
  retries: number;
  outcome: 'success' | 'failure';
  errorCode?: string;
};

export async function extractStructuredDocument<T>(
  input: ExtractionInput<T>,
  client: DocumentExtractionClient = getOpenAiClient() as unknown as DocumentExtractionClient,
): Promise<{ data: T; telemetry: DocumentExtractionTelemetry }> {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const entityRef = input.entity
    ? buildOpenAiSafetyIdentifier(input.entity.type, input.entity.id)
    : undefined;
  let attempts = 0;

  while (true) {
    attempts += 1;
    try {
      const response = await client.responses.create(
        {
          model: input.model,
          store: input.storeResponses ?? false,
          input: [
            { role: 'developer', content: [{ type: 'input_text', text: input.instructions }] },
            { role: 'user', content: input.content },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: input.schemaName,
              strict: true,
              schema: input.outputSchema,
            },
          },
          max_output_tokens: input.maxOutputTokens ?? 6000,
          ...(input.reasoningEffort ? { reasoning: { effort: input.reasoningEffort } } : {}),
          safety_identifier: entityRef,
          metadata: {
            use_case: input.useCase,
            prompt_version: input.promptVersion,
            request_id: requestId,
          },
        },
        { timeout: input.timeoutMs, maxRetries: 0 },
      );

      const responseRequestId = readRequestId(response) ?? requestId;
      const output = parseResponseOutput(response, responseRequestId);
      let data: T;
      try {
        data = input.validate(output);
      } catch (error) {
        const issues = readValidationIssues(error);
        throw new AppError(502, ErrorCodes.OPENAI_INVALID_OUTPUT, 'OpenAI output failed server validation', {
          retryable: false,
          requestId: responseRequestId,
          issues,
        });
      }

      return {
        data,
        telemetry: {
          provider: 'openai',
          useCase: input.useCase,
          model: input.model,
          promptVersion: input.promptVersion,
          requestId: responseRequestId,
          entityType: input.entity?.type,
          entityRef,
          latencyMs: Date.now() - startedAt,
          ...parseUsage(response),
          attempts,
          retries: attempts - 1,
          outcome: 'success',
        },
      };
    } catch (error) {
      const code = error instanceof AppError ? error.code : mapOpenAiRuntimeError(error);
      const retryable = isRetryableProviderCode(code);
      if (retryable && attempts <= input.maxRetries) {
        await delay(Math.min(8000, 250 * 2 ** (attempts - 1)));
        continue;
      }

      const errorRequestId = readRequestId(error) ?? readAppErrorRequestId(error) ?? requestId;
      const telemetry = {
        provider: 'openai' as const,
        useCase: input.useCase,
        model: input.model,
        promptVersion: input.promptVersion,
        requestId: errorRequestId,
        entityType: input.entity?.type,
        entityRef,
        latencyMs: Date.now() - startedAt,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        attempts,
        retries: attempts - 1,
        outcome: 'failure' as const,
        errorCode: code,
      } satisfies DocumentExtractionTelemetry;
      if (error instanceof AppError) {
        const details = asRecord(error.details);
        throw new AppError(error.statusCode, error.code, error.message, {
          retryable,
          requestId: errorRequestId,
          ...(Array.isArray(details?.issues) ? { issues: details.issues } : {}),
          telemetry,
        });
      }
      const statusCode =
        code === ErrorCodes.OPENAI_TIMEOUT || code === ErrorCodes.OPENAI_REQUEST_ABORTED
          ? 504
          : code === ErrorCodes.OPENAI_RATE_LIMITED || code === ErrorCodes.OPENAI_QUOTA_EXCEEDED
            ? 429
            : 502;
      throw new AppError(statusCode, code, 'OpenAI document extraction failed', {
        retryable,
        requestId: errorRequestId,
        telemetry,
      });
    }
  }
}

function parseResponseOutput(response: unknown, requestId: string): unknown {
  const record = asRecord(response);
  if (hasRefusal(record)) {
    throw new AppError(422, ErrorCodes.OPENAI_REFUSED, 'OpenAI refused to extract this document', {
      retryable: false,
      requestId,
    });
  }
  if (typeof record?.output_text !== 'string' || !record.output_text.trim()) {
    throw new AppError(502, ErrorCodes.OPENAI_INVALID_OUTPUT, 'OpenAI returned no structured document output', {
      retryable: false,
      requestId,
    });
  }
  try {
    return JSON.parse(record.output_text) as unknown;
  } catch {
    throw new AppError(502, ErrorCodes.OPENAI_INVALID_OUTPUT, 'OpenAI returned invalid structured document output', {
      retryable: false,
      requestId,
    });
  }
}

function hasRefusal(record: Record<string, unknown> | undefined): boolean {
  if (!Array.isArray(record?.output)) return false;
  return record.output.some((item) => {
    const message = asRecord(item);
    if (message?.type === 'refusal') return true;
    return (
      Array.isArray(message?.content) &&
      message.content.some((part) => asRecord(part)?.type === 'refusal')
    );
  });
}

function parseUsage(response: unknown) {
  const usage = asRecord(asRecord(response)?.usage);
  return {
    inputTokens: numberOrNull(usage?.input_tokens),
    outputTokens: numberOrNull(usage?.output_tokens),
    totalTokens: numberOrNull(usage?.total_tokens),
  };
}

function readValidationIssues(error: unknown) {
  const issues = asRecord(error)?.issues;
  if (!Array.isArray(issues)) return [];
  return issues.slice(0, 20).map((issue) => {
    const record = asRecord(issue);
    return {
      code: typeof record?.code === 'string' ? record.code : 'invalid',
      path: Array.isArray(record?.path) ? record.path.filter((part) => typeof part === 'string' || typeof part === 'number') : [],
    };
  });
}

function readRequestId(value: unknown): string | undefined {
  const record = asRecord(value);
  return typeof record?._request_id === 'string' ? record._request_id : undefined;
}

function readAppErrorRequestId(value: unknown): string | undefined {
  if (!(value instanceof AppError)) return undefined;
  const details = asRecord(value.details);
  return typeof details?.requestId === 'string' ? details.requestId : undefined;
}

function isRetryableProviderCode(code: string) {
  const retryableCodes: string[] = [
    ErrorCodes.OPENAI_TIMEOUT,
    ErrorCodes.OPENAI_REQUEST_ABORTED,
    ErrorCodes.OPENAI_RATE_LIMITED,
    ErrorCodes.OPENAI_NETWORK_ERROR,
    ErrorCodes.OPENAI_PROVIDER_ERROR,
  ];
  return retryableCodes.includes(code);
}

function numberOrNull(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

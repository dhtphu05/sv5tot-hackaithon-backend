import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import { normalizeSmartbotResponse } from '../../modules/chatbot/smartbot-card.normalizer';
import { redactSmartbotSecrets } from '../../modules/chatbot/chatbot.redactor';
import {
  assertSmartbotEnv,
  inspectSmartbotPayload,
  logSmartbotDiagnostic,
  smartbotFallbackText,
  throwIfEmptySmartbotCards,
} from './vnpt-smartbot.diagnostics';
import type {
  NormalizedSmartbotResponse,
  SmartbotConversationRequest,
  SmartbotStreamCallbacks,
  SmartbotStreamClient,
} from '../../modules/chatbot/chatbot.types';

const fallbackText = smartbotFallbackText;

export class VnptSmartBotStreamClient implements SmartbotStreamClient {
  async streamMessage(
    input: SmartbotConversationRequest,
    callbacks: SmartbotStreamCallbacks,
  ): Promise<NormalizedSmartbotResponse> {
    assertSmartbotEnv(input);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.SMARTBOT_TIMEOUT_MS);

    try {
      const response = await fetch(`${env.SMARTBOT_BASE_URL}/v1/conversation`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${env.SMARTBOT_ACCESS_TOKEN}`,
          'Token-id': env.SMARTBOT_TOKEN_ID,
          'Token-key': env.SMARTBOT_TOKEN_KEY,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(input),
      });

      const responseContentType = response.headers.get('content-type') ?? '';
      if (!response.ok) {
        const code = response.status === 401 || response.status === 403
          ? ErrorCodes.SMARTBOT_AUTH_FAILED
          : ErrorCodes.SMARTBOT_HTTP_ERROR;
        logSmartbotDiagnostic({
          request: input,
          httpStatus: response.status,
          errorCode: code,
          responseContentType,
        });
        throw new AppError(response.status, code, code);
      }

      if (responseContentType.includes('application/json')) {
        const raw = await parseJsonResponse(response, input, responseContentType);
        throwIfEmptySmartbotCards(raw, input, responseContentType);
        const payloadInfo = inspectSmartbotPayload(raw, responseContentType);
        logSmartbotDiagnostic({
          request: input,
          httpStatus: response.status,
          responseContentType,
          cardDataCount: payloadInfo.cardDataCount,
        });
        if (env.SMARTBOT_LOG_RAW_RESPONSE) {
          logger.debug({ response: redactSmartbotSecrets(raw) }, 'VNPT Smartbot JSON stream fallback response');
        }
        const normalized = normalizeSmartbotResponse({ raw, sessionId: input.session_id, fallbackText });
        await callbacks.onFinal?.(normalized);
        return normalized;
      }

      if (!response.body) {
        throw new Error('VNPT Smartbot stream response has no body');
      }

      return await readStream(response.body, input, callbacks, responseContentType, response.status);
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      if (isAbort) {
        logSmartbotDiagnostic({
          request: input,
          errorCode: ErrorCodes.SMARTBOT_TIMEOUT,
          timeout: true,
        });
        throw new AppError(504, ErrorCodes.SMARTBOT_TIMEOUT, ErrorCodes.SMARTBOT_TIMEOUT);
      }
      if (error instanceof AppError) throw error;
      logSmartbotDiagnostic({
        request: input,
        errorCode: ErrorCodes.SMARTBOT_NETWORK_ERROR,
      });
      throw new AppError(502, ErrorCodes.SMARTBOT_NETWORK_ERROR, ErrorCodes.SMARTBOT_NETWORK_ERROR);
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function readStream(
  body: ReadableStream<Uint8Array>,
  input: SmartbotConversationRequest,
  callbacks: SmartbotStreamCallbacks,
  responseContentType?: string,
  httpStatus?: number,
): Promise<NormalizedSmartbotResponse> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let previousAnswer = '';
  let finalResponse: NormalizedSmartbotResponse | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = extractStreamObjects(buffer);
    buffer = parsed.remainder;

    for (const raw of parsed.objects) {
      if (env.SMARTBOT_LOG_RAW_RESPONSE) {
        logger.debug({ response: redactSmartbotSecrets(raw) }, 'VNPT Smartbot stream chunk');
      }
      throwIfEmptySmartbotCards(raw, input, responseContentType);
      const payloadInfo = inspectSmartbotPayload(raw, responseContentType);
      if (payloadInfo.cardDataCount > 0) {
        logSmartbotDiagnostic({
          request: input,
          httpStatus,
          errorCode: undefined,
          responseContentType: payloadInfo.responseContentType,
          cardDataCount: payloadInfo.cardDataCount,
        });
      }
      const normalized = normalizeSmartbotResponse({ raw, sessionId: input.session_id, fallbackText });
      const delta = computeDelta(previousAnswer, normalized.answer);
      if (delta) {
        previousAnswer = normalized.answer;
        await callbacks.onDelta?.(delta);
      }
      if (normalized.smartbot.status === 1 && normalized.messages.length > 0) {
        await callbacks.onCard?.(normalized);
      }
      if (normalized.smartbot.status === 0 || normalized.smartbot.status === 2) {
        finalResponse = normalized;
        await callbacks.onFinal?.(normalized);
      }
    }
  }

  const tail = extractStreamObjects(buffer, true);
  for (const raw of tail.objects) {
    throwIfEmptySmartbotCards(raw, input, responseContentType);
    const normalized = normalizeSmartbotResponse({ raw, sessionId: input.session_id, fallbackText });
    const delta = computeDelta(previousAnswer, normalized.answer);
    if (delta) await callbacks.onDelta?.(delta);
    finalResponse = normalized;
    await callbacks.onFinal?.(normalized);
  }

  if (!finalResponse) {
    throw new AppError(502, ErrorCodes.SMARTBOT_PARSE_FAILED, ErrorCodes.SMARTBOT_PARSE_FAILED);
  }
  return finalResponse;
}

export function extractStreamObjects(
  input: string,
  flush = false,
): { objects: unknown[]; remainder: string } {
  const objects: unknown[] = [];
  let remainder = '';
  const frames = input.split(/\r?\n\r?\n/);
  if (!flush) {
    remainder = frames.pop() ?? '';
  }

  for (const frame of frames) {
    for (const candidate of frameToCandidates(frame)) {
      const parsed = tryParseJson(candidate);
      if (parsed !== undefined) objects.push(parsed);
    }
  }

  if (flush && remainder.trim()) {
    for (const candidate of frameToCandidates(remainder)) {
      const parsed = tryParseJson(candidate);
      if (parsed !== undefined) objects.push(parsed);
    }
    remainder = '';
  }

  if (!objects.length && !input.includes('\n\n')) {
    const lineParsed = parseLineDelimitedJson(input, flush);
    return lineParsed;
  }

  return { objects, remainder };
}

function frameToCandidates(frame: string): string[] {
  return frame
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith(':') && line !== 'data: [DONE]')
    .map((line) => (line.startsWith('data:') ? line.slice(5).trim() : line))
    .filter(Boolean);
}

function parseLineDelimitedJson(input: string, flush: boolean): { objects: unknown[]; remainder: string } {
  const lines = input.split(/\r?\n/);
  const remainder = flush ? '' : (lines.pop() ?? '');
  const objects = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map(tryParseJson)
    .filter((value): value is unknown => value !== undefined);

  if (flush && remainder.trim()) {
    const parsed = tryParseJson(remainder.trim());
    if (parsed !== undefined) objects.push(parsed);
  }

  return { objects, remainder };
}

function tryParseJson(value: string): unknown | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

async function parseJsonResponse(
  response: Response,
  input: SmartbotConversationRequest,
  responseContentType?: string,
): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    logSmartbotDiagnostic({
      request: input,
      httpStatus: response.status,
      errorCode: ErrorCodes.SMARTBOT_PARSE_FAILED,
      responseContentType,
    });
    throw new AppError(502, ErrorCodes.SMARTBOT_PARSE_FAILED, ErrorCodes.SMARTBOT_PARSE_FAILED);
  }
}

function computeDelta(previous: string, next: string): string {
  if (!next || next === previous) return '';
  if (next.startsWith(previous)) return next.slice(previous.length);
  return next;
}

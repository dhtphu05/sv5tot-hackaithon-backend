import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';

type GeminiGenerateOptions = {
  systemInstruction?: string;
  responseMimeType?: 'application/json' | 'text/plain';
  temperature?: number;
};

type GeminiGenerateRequest = {
  systemInstruction?: { parts: Array<{ text: string }> };
  contents: Array<{ role: 'user'; parts: Array<{ text: string }> }>;
  generationConfig?: {
    responseMimeType?: string;
    temperature?: number;
  };
};

export class GeminiClient {
  async generateText(prompt: string, options: GeminiGenerateOptions = {}): Promise<string> {
    const raw = await this.generate(prompt, options, false);
    return extractGeminiText(raw);
  }

  async generateJson(prompt: string, options: GeminiGenerateOptions = {}): Promise<unknown> {
    const text = await this.generateText(prompt, {
      ...options,
      responseMimeType: 'application/json',
      temperature: options.temperature ?? 0.1,
    });
    return parseJsonText(text);
  }

  async streamText(
    prompt: string,
    callbacks: { onDelta: (text: string) => Promise<void> | void },
    options: GeminiGenerateOptions = {},
  ): Promise<string> {
    if (!env.GEMINI_ENABLED) return '';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.GEMINI_TIMEOUT_MS);
    let fullText = '';

    try {
      const response = await fetch(geminiUrl('streamGenerateContent', true), {
        method: 'POST',
        signal: controller.signal,
        headers: geminiHeaders(),
        body: JSON.stringify(buildRequest(prompt, options)),
      });

      if (!response.ok) {
        throwGeminiHttpError(response.status);
      }
      if (!response.body) {
        throw new AppError(502, ErrorCodes.GEMINI_REQUEST_FAILED, ErrorCodes.GEMINI_REQUEST_FAILED);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = extractGeminiStreamObjects(buffer);
        buffer = parsed.remainder;

        for (const object of parsed.objects) {
          if (env.GEMINI_LOG_RAW_RESPONSE) {
            logger.debug({ response: object }, 'Gemini stream chunk');
          }
          const delta = extractGeminiText(object);
          if (delta) {
            fullText += delta;
            await callbacks.onDelta(delta);
          }
        }
      }

      const tail = extractGeminiStreamObjects(buffer, true);
      for (const object of tail.objects) {
        const delta = extractGeminiText(object);
        if (delta) {
          fullText += delta;
          await callbacks.onDelta(delta);
        }
      }

      return fullText;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AppError(504, ErrorCodes.GEMINI_TIMEOUT, ErrorCodes.GEMINI_TIMEOUT);
      }
      throw new AppError(502, ErrorCodes.GEMINI_REQUEST_FAILED, ErrorCodes.GEMINI_REQUEST_FAILED);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async generate(
    prompt: string,
    options: GeminiGenerateOptions,
    _stream: boolean,
  ): Promise<unknown> {
    if (!env.GEMINI_ENABLED) {
      throw new AppError(503, ErrorCodes.GEMINI_REQUEST_FAILED, 'Gemini is disabled');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.GEMINI_TIMEOUT_MS);

    try {
      const response = await fetch(geminiUrl('generateContent'), {
        method: 'POST',
        signal: controller.signal,
        headers: geminiHeaders(),
        body: JSON.stringify(buildRequest(prompt, options)),
      });
      const raw = await parseGeminiJson(response);

      if (!response.ok) {
        throwGeminiHttpError(response.status);
      }
      if (env.GEMINI_LOG_RAW_RESPONSE) {
        logger.debug({ response: raw }, 'Gemini response');
      }
      return raw;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AppError(504, ErrorCodes.GEMINI_TIMEOUT, ErrorCodes.GEMINI_TIMEOUT);
      }
      throw new AppError(502, ErrorCodes.GEMINI_REQUEST_FAILED, ErrorCodes.GEMINI_REQUEST_FAILED);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function buildRequest(prompt: string, options: GeminiGenerateOptions): GeminiGenerateRequest {
  return {
    ...(options.systemInstruction
      ? { systemInstruction: { parts: [{ text: options.systemInstruction }] } }
      : {}),
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      ...(options.responseMimeType ? { responseMimeType: options.responseMimeType } : {}),
      temperature: options.temperature ?? 0.2,
    },
  };
}

function geminiHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-goog-api-key': env.GEMINI_API_KEY,
  };
}

function geminiUrl(method: 'generateContent' | 'streamGenerateContent', stream = false): string {
  const model = encodeURIComponent(env.GEMINI_MODEL);
  const suffix = stream ? '?alt=sse' : '';
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}${suffix}`;
}

async function parseGeminiJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError(502, ErrorCodes.GEMINI_PARSE_FAILED, ErrorCodes.GEMINI_PARSE_FAILED);
  }
}

function extractGeminiText(value: unknown): string {
  const record = asRecord(value);
  const candidates = Array.isArray(record.candidates) ? record.candidates : [];
  return candidates
    .map((candidate) => {
      const content = asRecord(asRecord(candidate).content);
      const parts = Array.isArray(content.parts) ? content.parts : [];
      return parts
        .map((part) => {
          const text = asRecord(part).text;
          return typeof text === 'string' ? text : '';
        })
        .join('');
    })
    .join('');
}

function parseJsonText(text: string): unknown {
  const trimmed = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new AppError(502, ErrorCodes.GEMINI_PARSE_FAILED, ErrorCodes.GEMINI_PARSE_FAILED);
  }
}

function throwGeminiHttpError(status: number): never {
  const code = status === 401 || status === 403
    ? ErrorCodes.GEMINI_AUTH_FAILED
    : ErrorCodes.GEMINI_REQUEST_FAILED;
  logger.warn({ httpStatus: status, errorCode: code }, 'Gemini request failed');
  throw new AppError(status, code, code);
}

function extractGeminiStreamObjects(
  input: string,
  flush = false,
): { objects: unknown[]; remainder: string } {
  const objects: unknown[] = [];
  const frames = input.split(/\r?\n\r?\n/);
  const remainder = flush ? '' : (frames.pop() ?? '');

  for (const frame of frames) {
    const data = frame
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n')
      .trim();
    if (!data || data === '[DONE]') continue;
    const parsed = tryParse(data);
    if (parsed !== undefined) objects.push(parsed);
  }

  if (flush && remainder.trim()) {
    const parsed = tryParse(remainder.replace(/^data:\s*/gm, '').trim());
    if (parsed !== undefined) objects.push(parsed);
  }

  return { objects, remainder };
}

function tryParse(value: string): unknown | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

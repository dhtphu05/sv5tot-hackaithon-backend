import { promises as fs } from 'node:fs';
import path from 'node:path';
import { logger } from '../../config/logger';
import type { SmartReaderConfig } from './smartreader.config';
import { smartReaderConfig } from './smartreader.config';
import { SmartReaderError } from './smartreader.errors';
import {
  mapAdministrativeDocResponse,
  mapAsyncResultResponse,
  mapAsyncStartResponse,
  mapCancelResponse,
  mapOcrResponse,
  mapUploadResponse,
} from './smartreader.mapper';
import { redactSmartReaderSecrets } from './smartreader.redactor';
import type {
  AdministrativeDocResult,
  SmartReaderAdapter,
  SmartReaderAsyncResult,
  SmartReaderCancelResult,
  SmartReaderExporter,
  SmartReaderOcrResult,
  SmartReaderUploadResult,
} from './smartreader.types';

type JsonPayload = Record<string, unknown>;

type RequestOptions = {
  method: 'GET' | 'POST';
  path: string;
  body?: string | FormData;
  headers?: Record<string, string>;
  retryableBodyFactory?: () => Promise<string | FormData>;
};

export class SmartReaderClient implements SmartReaderAdapter {
  constructor(private readonly config: SmartReaderConfig = smartReaderConfig) {}

  async uploadFile(input: {
    filePath: string;
    originalName?: string;
    title?: string;
    description?: string;
  }): Promise<SmartReaderUploadResult> {
    const response = await this.request({
      method: 'POST',
      path: this.config.uploadPath,
      retryableBodyFactory: () => this.createUploadForm(input),
    });
    return mapUploadResponse(response);
  }

  async ocrBasic(input: {
    fileHash: string;
    fileType: string;
    details?: boolean;
  }): Promise<SmartReaderOcrResult> {
    const response = await this.postJson(this.config.ocrBasicPath, this.ocrPayload(input));
    return mapOcrResponse(response);
  }

  async ocrAdvanced(input: {
    fileHash: string;
    fileType: string;
    details?: boolean;
    exporter?: SmartReaderExporter;
  }): Promise<SmartReaderOcrResult> {
    const response = await this.postJson(this.config.ocrAdvancedPath, this.ocrPayload(input));
    return mapOcrResponse(response);
  }

  async startAdvancedAsync(input: {
    fileHash: string;
    fileType: string;
    details?: boolean;
    exporter?: SmartReaderExporter;
  }): Promise<{
    sessionId: string;
    status: 'started';
    warnings: string[];
    warningMessages: string[];
    raw: unknown;
  }> {
    const response = await this.postJson(this.config.ocrAsyncStartPath, this.ocrPayload(input));
    return mapAsyncStartResponse(response);
  }

  async getAdvancedAsyncResult(sessionId: string): Promise<SmartReaderAsyncResult> {
    const response = await this.postJson(this.config.ocrAsyncResultPath, { session_id: sessionId });
    return mapAsyncResultResponse(sessionId, response);
  }

  async cancelAdvancedAsync(sessionId: string): Promise<SmartReaderCancelResult> {
    const response = await this.postJson(this.config.ocrAsyncCancelPath, { session_id: sessionId });
    return mapCancelResponse(sessionId, response);
  }

  async extractAdministrativeDocument(input: {
    fileHash: string;
    fileType: string;
    details?: boolean;
  }): Promise<AdministrativeDocResult> {
    const response = await this.postJson(this.config.adminDocPath, this.ocrPayload(input));
    return mapAdministrativeDocResponse(response);
  }

  private async postJson(pathName: string, payload: JsonPayload): Promise<unknown> {
    return this.request({
      method: 'POST',
      path: pathName,
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private ocrPayload(input: {
    fileHash: string;
    fileType: string;
    details?: boolean;
    exporter?: SmartReaderExporter;
  }): JsonPayload {
    return {
      file_hash: input.fileHash,
      file_type: input.fileType,
      details: input.details ?? true,
      token: this.config.defaultToken,
      client_session: this.config.clientSession,
      ...(input.exporter ? { exporter: input.exporter } : {}),
    };
  }

  private async request(options: RequestOptions): Promise<unknown> {
    let lastError: unknown;
    const maxAttempts = this.config.retryMax + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

      try {
        const body = options.retryableBodyFactory ? await options.retryableBodyFactory() : options.body;
        const response = await fetch(this.url(options.path), {
          method: options.method,
          headers: {
            ...this.authHeaders(),
            ...options.headers,
          },
          body,
          signal: controller.signal,
        });
        const parsed = await parseResponseBody(response);

        if (!response.ok) {
          const details = {
            httpStatus: response.status,
            endpoint: options.path,
            body: parsed,
          };

          if (response.status >= 500 && attempt < maxAttempts) {
            lastError = new SmartReaderError('VNPT SmartReader returned a retriable HTTP error', details);
            await wait(backoffDelay(attempt));
            continue;
          }

          throw new SmartReaderError('VNPT SmartReader request failed', details, response.status);
        }

        if (this.config.logRawResponse) {
          logger.debug(
            { endpoint: options.path, response: redactSmartReaderSecrets(parsed) },
            'VNPT SmartReader response',
          );
        }

        return parsed;
      } catch (error) {
        if (!isRetriableError(error) || attempt >= maxAttempts) {
          if (error instanceof SmartReaderError) throw error;
          throw new SmartReaderError('VNPT SmartReader request failed', {
            endpoint: options.path,
            error: error instanceof Error ? error.message : error,
          });
        }

        lastError = error;
        await wait(backoffDelay(attempt));
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new SmartReaderError('VNPT SmartReader request failed after retries', {
      endpoint: options.path,
      error: lastError instanceof Error ? lastError.message : lastError,
    });
  }

  private async createUploadForm(input: {
    filePath: string;
    originalName?: string;
    title?: string;
    description?: string;
  }): Promise<FormData> {
    const fileBuffer = await fs.readFile(input.filePath);
    const fileName = input.originalName ?? path.basename(input.filePath);
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(fileBuffer)]), fileName);
    form.append('title', input.title ?? fileName);
    form.append('description', input.description ?? '5TOT SmartReader upload');
    return form;
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.accessToken}`,
      'Token-id': this.config.tokenId,
      'Token-key': this.config.tokenKey,
      'mac-address': this.config.macAddress,
    };
  }

  private url(pathName: string): string {
    return `${this.config.baseUrl}${pathName.startsWith('/') ? pathName : `/${pathName}`}`;
  }
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { rawText: text };
  }
}

function isRetriableError(error: unknown): boolean {
  if (error instanceof SmartReaderError) return error.statusCode >= 500;
  if (!(error instanceof Error)) return false;
  return error.name === 'AbortError' || error.name === 'TimeoutError' || error.name === 'TypeError';
}

function backoffDelay(attempt: number): number {
  return Math.min(500 * 2 ** (attempt - 1), 5000);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

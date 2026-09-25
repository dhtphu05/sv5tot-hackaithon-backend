import { env } from '../../config/env';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import { getSmartReaderAdapter, mapOcrResponse, type SmartReaderOcrResult } from './index';
import type { SmartReaderAdapter, SmartReaderAsyncResult } from './smartreader.types';

export async function runSmartReaderAsyncTableOcr(input: {
  fileHash: string;
  fileType: string;
  adapter?: SmartReaderAdapter;
  maxPolls?: number;
  waitBeforePoll?: (pollCount: number) => Promise<void>;
  onStarted?: (started: { sessionId: string; raw: unknown }) => Promise<void>;
  onProgress?: (result: SmartReaderAsyncResult) => Promise<void>;
  onPollingSummary?: (summary: {
    pollCount?: number;
    status?: string;
    processedPages?: number | null;
    remainingPages?: number | null;
    maxPolls?: number;
  }) => Promise<void>;
}): Promise<SmartReaderOcrResult> {
  const adapter = input.adapter ?? getSmartReaderAdapter();
  const maxPolls = input.maxPolls ?? env.SMARTREADER_ASYNC_MAX_POLLS;
  const started = await adapter.startAdvancedAsync({
    fileHash: input.fileHash,
    fileType: input.fileType,
    details: true,
    exporter: 'json',
  });
  await input.onStarted?.({ sessionId: started.sessionId, raw: started.raw });

  let lastProgress: { processedPages?: number | null; remainingPages?: number | null; status?: string } = {};
  for (let pollCount = 1; pollCount <= maxPolls; pollCount += 1) {
    await (input.waitBeforePoll?.(pollCount) ?? wait(env.VNPT_ENABLED ? 5000 : 0));
    const result = await adapter.getAdvancedAsyncResult(started.sessionId);
    lastProgress = {
      processedPages: result.processedPages,
      remainingPages: result.remainingPages,
      status: result.status,
    };
    await input.onProgress?.(result);

    if (result.status === 'completed' || result.status === 'completed_with_link') {
      const ocr = result.resultLink ? await downloadResultLink(result.resultLink) : result;
      await input.onPollingSummary?.({
        pollCount,
        status: result.status,
        processedPages: result.processedPages,
        remainingPages: result.remainingPages,
      });
      return ocr;
    }
    if (result.status === 'failed' || result.status === 'cancelled') {
      throw new AppError(502, ErrorCodes.VNPT_OCR_FAILED, `VNPT async OCR ended with status ${result.status}`);
    }
  }

  await input.onPollingSummary?.({ maxPolls, ...lastProgress });
  throw new AppError(
    504,
    ErrorCodes.VNPT_ASYNC_TIMEOUT,
    `VNPT async OCR exceeded max polls ${maxPolls}`,
    { retryable: true },
  );
}

async function downloadResultLink(resultLink: string): Promise<SmartReaderOcrResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.VNPT_TIMEOUT_MS);
  try {
    const response = await fetch(resultLink, { signal: controller.signal });
    if (!response.ok) {
      throw new AppError(
        502,
        ErrorCodes.VNPT_RESULT_LINK_DOWNLOAD_FAILED,
        `VNPT result link download failed with HTTP ${response.status}`,
      );
    }
    const raw = JSON.parse(await response.text()) as unknown;
    try {
      return mapOcrResponse(raw);
    } catch {
      const record = raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
      return mapOcrResponse({
        message: 'IDG-00000000',
        status: 'OK',
        statusCode: 200,
        object: record.object ?? record.data ?? record,
      });
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      502,
      ErrorCodes.VNPT_RESULT_LINK_DOWNLOAD_FAILED,
      'VNPT result link download failed',
      { technicalMessage: error instanceof Error ? error.message : String(error), retryable: true },
    );
  } finally {
    clearTimeout(timeout);
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

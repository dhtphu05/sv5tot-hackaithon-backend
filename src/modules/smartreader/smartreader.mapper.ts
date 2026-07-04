import type {
  AdministrativeDocResult,
  SmartReaderAsyncResult,
  SmartReaderCancelResult,
  SmartReaderOcrResult,
  SmartReaderTable,
  SmartReaderUploadResult,
  VnptEnvelope,
} from './smartreader.types';
import { SmartReaderResponseError } from './smartreader.errors';

const VNPT_SUCCESS_MESSAGE = 'IDG-00000000';

export function assertSuccessfulEnvelope(raw: unknown): VnptEnvelope {
  const envelope = asRecord(raw) as VnptEnvelope;
  const message = stringValue(envelope.message);
  const statusCode = numberValue(envelope.statusCode);
  const status = stringValue(envelope.status)?.toLowerCase();
  const object = asRecord(envelope.object);
  const processingWarnings = [
    ...normalizeArray(object.warning),
    ...stringArray(object.warnings),
    ...stringArray(object.warning_messages),
    ...stringArray(object.warningMessages),
  ];
  const isSuccessful =
    message === VNPT_SUCCESS_MESSAGE ||
    statusCode === 200 ||
    status === 'ok' ||
    status === 'success' ||
    status === '200' ||
    isProcessingMessage(message) ||
    processingWarnings.some(isProcessingMessage);

  if (!isSuccessful) {
    throw new SmartReaderResponseError('VNPT SmartReader returned an unsuccessful response', {
      message: envelope.message,
      status: envelope.status,
      statusCode: envelope.statusCode,
      logID: envelope.logID,
      server_version: envelope.server_version,
    });
  }

  return envelope;
}

export function mapUploadResponse(raw: unknown): SmartReaderUploadResult {
  const envelope = assertSuccessfulEnvelope(raw);
  const object = asRecord(envelope.object);
  const hash =
    stringValue(object.hash) ??
    stringValue(object.fileHash) ??
    stringValue(object.file_hash) ??
    stringValue(object.file_id);
  const fileType =
    stringValue(object.fileType) ??
    stringValue(object.file_type) ??
    stringValue(object.type) ??
    stringValue(object.mimeType);

  if (!hash || !fileType) {
    throw new SmartReaderResponseError('VNPT upload response did not include hash and fileType', {
      object,
      logID: envelope.logID,
    });
  }

  return {
    hash,
    fileType,
    fileName: stringValue(object.fileName) ?? stringValue(object.file_name),
    tokenId: stringValue(object.tokenId) ?? stringValue(object.token_id),
    raw,
  };
}

export function mapOcrResponse(raw: unknown): SmartReaderOcrResult {
  const envelope = assertSuccessfulEnvelope(raw);
  return mapOcrObject(envelope.object, raw);
}

export function mapAsyncStartResponse(raw: unknown): {
  sessionId: string;
  status: 'started';
  warnings: string[];
  warningMessages: string[];
  raw: unknown;
} {
  const envelope = assertSuccessfulEnvelope(raw);
  const object = asRecord(envelope.object);
  const sessionId =
    stringValue(object.session_id) ??
    stringValue(object.sessionId) ??
    stringValue(object.clientSession) ??
    stringValue(object.id);

  if (!sessionId) {
    throw new SmartReaderResponseError('VNPT async start response did not include session_id', {
      object,
      logID: envelope.logID,
    });
  }

  return {
    sessionId,
    status: 'started',
    warnings: normalizeArray(object.warnings ?? object.warning),
    warningMessages: normalizeArray(object.warningMessages ?? object.warning_messages),
    raw,
  };
}

export function mapAsyncResultResponse(sessionId: string, raw: unknown): SmartReaderAsyncResult {
  const envelope = assertSuccessfulEnvelope(raw);
  const object = asRecord(envelope.object);
  const resultObject = object.result ?? object.data ?? object;
  const ocr = mapOcrObject(resultObject, raw);
  const resultRecord = asRecord(resultObject);
  const warnings = normalizeArray(object.warnings ?? object.warning ?? resultRecord.warnings ?? resultRecord.warning);
  const warningMessages = normalizeArray(
    object.warningMessages ??
      object.warning_messages ??
      resultRecord.warningMessages ??
      resultRecord.warning_messages,
  );
  const resultLink =
    stringValue(object.link) ??
    stringValue(object.result_link) ??
    stringValue(object.resultLink) ??
    stringValue(resultRecord.link) ??
    stringValue(resultRecord.result_link) ??
    stringValue(resultRecord.resultLink);
  const processedPages =
    numberValue(object.num_of_processed_page) ??
    numberValue(object.processed_pages) ??
    numberValue(object.progressProcessedPages) ??
    numberValue(object.progress_processed_pages) ??
    numberValue(resultRecord.num_of_processed_page) ??
    numberValue(resultRecord.processed_pages) ??
    numberValue(resultRecord.progress_processed_pages);
  const remainingPages =
    numberValue(object.num_of_remaining_pages) ??
    numberValue(object.remaining_pages) ??
    numberValue(object.progressRemainingPages) ??
    numberValue(object.progress_remaining_pages) ??
    numberValue(resultRecord.num_of_remaining_pages) ??
    numberValue(resultRecord.remaining_pages) ??
    numberValue(resultRecord.progress_remaining_pages);
  const numOfPages = pageCountValue(
    object.numOfPages,
    object.num_of_pages,
    object.total_page_num,
    object.pages,
    object.totalPages,
    resultRecord.numOfPages,
    resultRecord.num_of_pages,
    resultRecord.total_page_num,
    resultRecord.pages,
    resultRecord.totalPages,
  );
  const status = normalizeAsyncStatus({
    status:
      stringValue(object.status) ??
      stringValue(resultRecord.status) ??
      stringValue(envelope.status),
    message: stringValue(envelope.message) ?? stringValue(object.message) ?? stringValue(resultRecord.message),
    warnings: [...warnings, ...warningMessages],
    hasResultLink: !!resultLink,
    hasProgress: processedPages !== undefined || remainingPages !== undefined,
    isOkResponse: isOkEnvelope(envelope),
  });
  const completedProcessedPages = status === 'completed' ? (numOfPages ?? processedPages ?? null) : processedPages;
  const completedRemainingPages = status === 'completed' ? 0 : remainingPages;

  return {
    ...ocr,
    warnings,
    warningMessages,
    numOfPages,
    sessionId:
      stringValue(object.session_id) ??
      stringValue(object.sessionId) ??
      stringValue(resultRecord.session_id) ??
      sessionId,
    status,
    processedPages: completedProcessedPages ?? null,
    remainingPages: completedRemainingPages ?? null,
    progressProcessedPages: completedProcessedPages ?? null,
    progressRemainingPages: completedRemainingPages ?? null,
    resultLink,
    objectKeys: Object.keys(object),
  };
}

export function mapCancelResponse(sessionId: string, raw: unknown): SmartReaderCancelResult {
  const envelope = assertSuccessfulEnvelope(raw);
  const object = asRecord(envelope.object);

  return {
    sessionId: stringValue(object.session_id) ?? stringValue(object.sessionId) ?? sessionId,
    status: normalizeCancelStatus(stringValue(object.status)),
    warnings: normalizeArray(object.warnings ?? object.warning),
    warningMessages: normalizeArray(object.warningMessages ?? object.warning_messages),
    raw,
  };
}

export function mapAdministrativeDocResponse(raw: unknown): AdministrativeDocResult {
  const envelope = assertSuccessfulEnvelope(raw);
  const object = asRecord(envelope.object);
  const fields = asRecord(object.fields ?? object.data ?? object.result ?? object);

  return {
    fields,
    text: collectText(fields) || collectText(object),
    warnings: stringArray(object.warnings ?? fields.warnings),
    warningMessages: stringArray(object.warningMessages ?? object.warning_messages),
    raw,
  };
}

function mapOcrObject(objectValue: unknown, raw: unknown): SmartReaderOcrResult {
  const object = asRecord(objectValue);
  const lines = arrayOfRecords(object.lines ?? object.line).map((line) => ({
    text: stringValue(line.text ?? line.value ?? line.content) ?? '',
    confidence: numberValue(line.confidence ?? line.conf),
    page: numberValue(line.page ?? line.page_num ?? line.pageNum),
    bbox: line.bbox ?? line.box,
  }));
  const paragraphs = arrayOfRecords(object.paragraphs ?? object.paragraph).map((paragraph) => ({
    text: stringValue(paragraph.text ?? paragraph.value ?? paragraph.content) ?? '',
    confidence: numberValue(paragraph.confidence ?? paragraph.conf),
    page: numberValue(paragraph.page ?? paragraph.page_num ?? paragraph.pageNum),
  }));
  const tables = arrayOfRecords(object.tables ?? object.table).map((table): SmartReaderTable => {
    const rows = Array.isArray(table.rows) ? table.rows : Array.isArray(table.cells) ? table.cells : [];
    return {
      rows,
      page: numberValue(table.page ?? table.page_num ?? table.pageNum),
      confidence: numberValue(table.confidence ?? table.conf),
    };
  });

  return {
    text:
      stringValue(object.text) ??
      stringValue(object.ocrText) ??
      stringValue(object.full_text) ??
      collectText({ lines, paragraphs }),
    lines: lines.filter((line) => line.text),
    paragraphs: paragraphs.filter((paragraph) => paragraph.text),
    tables,
    warnings: normalizeArray(object.warnings ?? object.warning),
    warningMessages: normalizeArray(object.warningMessages ?? object.warning_messages),
    numOfPages: pageCountValue(
      object.numOfPages,
      object.num_of_pages,
      object.total_page_num,
      object.pages,
      object.totalPages,
    ),
    raw,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function pageCountValue(...values: unknown[]): number | undefined {
  const numbers = values
    .map((value) => numberValue(value))
    .filter((value): value is number => value !== undefined);
  return numbers.find((value) => value > 0) ?? numbers[0];
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => stringValue(item)).filter((item): item is string => !!item);
}

function normalizeArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => stringValue(item)).filter((item): item is string => !!item);
  }
  const single = stringValue(value);
  return single ? [single] : [];
}

function collectText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => collectText(item)).filter(Boolean).join('\n');
  }
  if (!value || typeof value !== 'object') return typeof value === 'string' ? value : '';

  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string') return record.text;
  return Object.values(record)
    .map((item) => collectText(item))
    .filter(Boolean)
    .join('\n');
}

function normalizeAsyncStatus(input: {
  status?: string;
  message?: string;
  warnings?: string[];
  hasResultLink?: boolean;
  hasProgress?: boolean;
  isOkResponse?: boolean;
}): SmartReaderAsyncResult['status'] {
  if (input.hasResultLink) return 'completed';

  const normalized = input.status?.toLowerCase();
  if (normalized === 'queued' || normalized === 'started') return 'started';
  if (normalized === 'processing') return 'processing';
  if (normalized === 'completed' || normalized === 'done' || normalized === 'success') return 'completed';
  if (normalized === 'failed' || normalized === 'error') return 'failed';
  if (normalized === 'cancelled' || normalized === 'canceled') return 'cancelled';
  if (isProcessingMessage(input.message) || input.warnings?.some(isProcessingMessage)) {
    return 'processing';
  }
  if (input.hasProgress) return 'processing';
  if (input.isOkResponse) return 'unknown_ok_response';
  return 'unknown';
}

function isOkEnvelope(envelope: VnptEnvelope): boolean {
  const status = stringValue(envelope.status)?.toLowerCase();
  const statusCode = numberValue(envelope.statusCode);
  return status === 'ok' || status === 'success' || status === '200' || statusCode === 200;
}

function isProcessingMessage(value?: string): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return (
    normalized.includes('processing') ||
    normalized.includes('pending') ||
    normalized.includes('in progress') ||
    normalized.includes('request_dang_trong_qua_trinh_xu_ly') ||
    normalized.includes('dang xu ly') ||
    normalized.includes('đang xử lý') ||
    normalized.includes('trong qua trinh') ||
    normalized.includes('trong quá trình')
  );
}

function normalizeCancelStatus(value?: string): SmartReaderCancelResult['status'] {
  const normalized = value?.toLowerCase();
  if (normalized === 'cancelled' || normalized === 'canceled' || normalized === 'success') {
    return 'cancelled';
  }
  if (normalized === 'failed' || normalized === 'error') return 'failed';
  return 'unknown';
}

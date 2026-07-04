import { promises as fs } from 'node:fs';
import path from 'node:path';
import { env } from '../src/config/env';
import { logger } from '../src/config/logger';
import { prisma } from '../src/infrastructure/database/prisma';
import { AuditService } from '../src/modules/audit/audit.service';
import { getSmartReaderAdapter } from '../src/modules/smartreader';
import { redactSmartReaderSecrets } from '../src/modules/smartreader/smartreader.redactor';
import type {
  AdministrativeDocResult,
  SmartReaderAsyncResult,
  SmartReaderOcrResult,
} from '../src/modules/smartreader/smartreader.types';
import { auditActions } from '../src/shared/constants/application';

type SmokeMode = 'upload' | 'basic' | 'advanced' | 'admin' | 'async';

const outputDirectory = path.resolve(process.cwd(), 'tmp/smartreader-smoke');
const adapter = getSmartReaderAdapter();
const auditService = new AuditService();

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const filePath = args.file ? path.resolve(process.cwd(), args.file) : '';
  const mode = parseMode(args.mode);
  const pollOptions = {
    maxPollCount: parsePositiveInt(
      args['max-polls'] ?? args.maxPollCount,
      env.SMARTREADER_ASYNC_MAX_POLLS,
    ),
    pollIntervalMs: parsePositiveInt(args['poll-interval-ms'] ?? args.pollIntervalMs, 5000),
  };

  if (!filePath) {
    throw new Error('Missing required --file argument');
  }

  await fs.access(filePath);
  await fs.mkdir(outputDirectory, { recursive: true });

  await audit(auditActions.SMARTREADER_SMOKE_TEST_RUN, { mode, filePath });
  await audit(auditActions.SMARTREADER_FILE_UPLOAD_STARTED, { mode, fileName: path.basename(filePath) });

  const upload = await adapter.uploadFile({
    filePath,
    originalName: path.basename(filePath),
    title: path.basename(filePath),
    description: `5TOT SmartReader smoke ${mode}`,
  });

  await audit(auditActions.SMARTREADER_FILE_UPLOADED, {
    mode,
    hash: upload.hash,
    fileType: upload.fileType,
  });
  await writeOutput('latest-upload.json', {
    dateTime: new Date().toISOString(),
    mode,
    upload,
  });

  console.log(`VNPT SmartReader mode=${mode}`);
  console.log(`hash=${upload.hash}`);
  console.log(`fileType=${upload.fileType}`);

  if (mode === 'upload') {
    return;
  }

  if (mode === 'basic') {
    await runOcr(mode, () =>
      adapter.ocrBasic({ fileHash: upload.hash, fileType: upload.fileType, details: true }),
    );
    return;
  }

  if (mode === 'advanced') {
    await runOcr(mode, () =>
      adapter.ocrAdvanced({
        fileHash: upload.hash,
        fileType: upload.fileType,
        details: true,
        exporter: 'json',
      }),
    );
    return;
  }

  if (mode === 'admin') {
    await audit(auditActions.SMARTREADER_OCR_STARTED, { mode, hash: upload.hash });
    try {
      const admin = await adapter.extractAdministrativeDocument({
        fileHash: upload.hash,
        fileType: upload.fileType,
        details: true,
      });
      const adminSummary = summarizeAdminFields(admin);
      await audit(auditActions.SMARTREADER_ADMIN_DOC_EXTRACTED, {
        fields: Object.keys(admin.fields),
        hash: upload.hash,
      });
      await writeOutput('latest-admin.json', { mode, upload, status: 'OK', admin, summary: adminSummary });
      console.log(
        `admin status=OK documentNo=${adminSummary.documentNo ?? 'unknown'} type=${
          adminSummary.type ?? 'unknown'
        } issueDate=${adminSummary.issueDate ?? 'unknown'} signer=${adminSummary.signer ?? 'unknown'}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeOutput('latest-admin.json', {
        mode,
        upload,
        status: 'failed',
        warning: 'admin_doc_extract_failed',
        error: message,
      });
      console.log(`admin status=failed warning=admin_doc_extract_failed message=${message}`);
    }
    return;
  }

  await runAsync(upload.hash, upload.fileType, pollOptions);
}

async function runOcr(mode: 'basic' | 'advanced', fn: () => Promise<SmartReaderOcrResult>) {
  await audit(auditActions.SMARTREADER_OCR_STARTED, { mode });
  const result = await fn();
  await audit(auditActions.SMARTREADER_OCR_COMPLETED, {
    mode,
    tableCount: result.tables.length,
    numOfPages: result.numOfPages,
    warnings: result.warnings,
  });
  await writeOutput('latest-ocr.json', { mode, result });
  console.log(`pages=${result.numOfPages ?? 'unknown'}`);
  console.log(`lines=${result.lines.length}`);
  console.log(`paragraphs=${result.paragraphs.length}`);
  console.log(`tables=${result.tables.length}`);
  console.log(`warnings=${result.warnings.join(',') || 'none'}`);
}

async function runAsync(
  fileHash: string,
  fileType: string,
  options: { maxPollCount: number; pollIntervalMs: number },
): Promise<void> {
  await audit(auditActions.SMARTREADER_OCR_STARTED, { mode: 'async', hash: fileHash });
  const started = await adapter.startAdvancedAsync({
    fileHash,
    fileType,
    details: true,
    exporter: 'json',
  });
  await writeOutput('latest-async-start.json', { started });
  console.log(`async started sessionId=${started.sessionId}`);

  const startTime = Date.now();
  let latestResult: unknown = started;
  let status = 'processing';
  let pollCount = 0;
  let terminal = false;

  while (pollCount < options.maxPollCount && Date.now() - startTime < env.VNPT_TIMEOUT_MS) {
    pollCount += 1;
    await wait(options.pollIntervalMs);
    const result = await adapter.getAdvancedAsyncResult(started.sessionId);
    latestResult = result;
    status = result.status;
    await writeOutput(`latest-async-poll-${pollCount}.json`, { pollCount, result });
    logPollResult(result);

    if (result.status === 'completed') {
      terminal = true;
      const download = result.resultLink ? await downloadAsyncResult(result.resultLink) : undefined;
      const completedStatus = download?.ok === false ? 'completed_with_link' : 'completed';
      status = completedStatus;
      if (download?.ok === false) {
        result.warningMessages.push('result_link_download_failed');
        console.log(`async status=completed_with_link warning=${download.warning} resultLink=present`);
        await writeOutput('latest-async-result.json', download);
      }
      await audit(auditActions.SMARTREADER_OCR_COMPLETED, {
        sessionId: result.sessionId,
        tableCount: result.tables.length,
        numOfPages: result.numOfPages,
        status: completedStatus,
      });
      await writeOutput('latest-async-final.json', {
        status: completedStatus,
        result,
        downloadedResult: download,
      });
      break;
    }

    if (result.status === 'failed' || result.status === 'cancelled') {
      terminal = true;
      await audit(auditActions.SMARTREADER_OCR_FAILED, { sessionId: result.sessionId, status: result.status });
      await writeOutput('latest-async-final.json', { status: result.status, result });
      break;
    }
  }

  if (!terminal) {
    status = Date.now() - startTime >= env.VNPT_TIMEOUT_MS ? 'timeout' : 'max_polls_exceeded';
    console.log(
      `async ${status} after polls=${pollCount} elapsedMs=${Date.now() - startTime} timeoutMs=${
        env.VNPT_TIMEOUT_MS
      } maxPolls=${options.maxPollCount}`,
    );
    await audit(auditActions.SMARTREADER_OCR_FAILED, {
      sessionId: started.sessionId,
      status,
      pollCount,
      elapsedMs: Date.now() - startTime,
    });
  }

  await writeOutput('latest-async.json', {
    status,
    pollCount,
    maxPollCount: options.maxPollCount,
    timeoutMs: env.VNPT_TIMEOUT_MS,
    started,
    latestResult,
  });
}

async function writeOutput(fileName: string, payload: unknown): Promise<void> {
  const redacted = redactSmartReaderSecrets(payload);
  await fs.writeFile(path.join(outputDirectory, fileName), `${JSON.stringify(redacted, null, 2)}\n`);
}

async function audit(action: string, metadata: Record<string, unknown>): Promise<void> {
  if (!env.SMARTREADER_SMOKE_AUDIT_ENABLED) {
    return;
  }

  try {
    await auditService.log({
      action,
      entityType: 'smartreader_smoke',
      metadata: redactSmartReaderSecrets(metadata),
    });
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : error, action },
      'SmartReader smoke audit write failed',
    );
  }
}

function logPollResult(result: SmartReaderAsyncResult): void {
  if (result.status === 'completed') {
    console.log(
      `poll status=completed pages=${result.numOfPages ?? 'unknown'} resultLink=${
        result.resultLink ? 'present' : 'missing'
      }`,
    );
    return;
  }

  if (result.status === 'unknown_ok_response') {
    console.log(`poll status=unknown_ok_response objectKeys=[${result.objectKeys?.join(',') ?? ''}]`);
    return;
  }

  if (result.status === 'failed') {
    console.log(`poll status=failed warnings=${formatWarnings(result)}`);
    return;
  }

  console.log(
    `poll status=${result.status} processed=${result.processedPages ?? 'unknown'} remaining=${
      result.remainingPages ?? 'unknown'
    } warnings=${formatWarnings(result)}`,
  );
}

function formatWarnings(result: SmartReaderAsyncResult): string {
  const warnings = [...result.warnings, ...result.warningMessages];
  return warnings.length ? warnings.join('|') : 'none';
}

async function downloadAsyncResult(
  resultLink: string,
): Promise<
  | { ok: true; summary: ReturnType<typeof summarizeDownloadedResult>; raw: unknown }
  | { ok: false; warning: 'result_link_download_failed'; error: string; resultLink: string }
> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(resultLink, { signal: controller.signal });
    if (!response.ok) {
      return {
        ok: false,
        warning: 'result_link_download_failed',
        error: `HTTP ${response.status}`,
        resultLink,
      };
    }

    const rawText = await response.text();
    const raw = parseMaybeJson(rawText);
    const summary = summarizeDownloadedResult(raw);
    await writeOutput('latest-async-result.json', { summary, raw });
    console.log(
      `async result downloaded sampleTextLength=${summary.sampleText.length} lineCount=${summary.lineCount} paragraphCount=${summary.paragraphCount} tableCount=${summary.tableCount} pages=${summary.numOfPages ?? 'unknown'}`,
    );
    return { ok: true, summary, raw };
  } catch (error) {
    return {
      ok: false,
      warning: 'result_link_download_failed',
      error: error instanceof Error ? error.message : String(error),
      resultLink,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function summarizeDownloadedResult(raw: unknown): {
  sampleText: string;
  tableCount: number;
  lineCount: number;
  paragraphCount: number;
  numOfPages?: number;
} {
  const texts = collectTextValues(raw);
  return {
    sampleText: texts.join('\n').slice(0, 1000),
    tableCount: countTables(raw),
    lineCount: countLineLikeItems(raw),
    paragraphCount: countParagraphLikeItems(raw),
    numOfPages: firstNumberByKeys(raw, ['num_of_pages', 'total_page_num', 'numOfPages', 'totalPages']),
  };
}

function parseMaybeJson(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return { text: value };
  }
}

function summarizeAdminFields(admin: AdministrativeDocResult): {
  documentNo?: string;
  type?: string;
  issueDate?: string;
  signer?: string;
} {
  return {
    documentNo: stringValue(admin.fields.so_ky_hieu),
    type: stringValue(admin.fields.loai_van_ban),
    issueDate: stringValue(admin.fields.ngay_ban_hanh),
    signer: stringValue(admin.fields.nguoi_ky),
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function collectTextValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((item) => collectTextValues(item));
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  return Object.entries(record).flatMap(([key, nested]) =>
    key === 'text' && typeof nested === 'string' ? [nested] : collectTextValues(nested),
  );
}

function countKeys(value: unknown, keys: string[]): number {
  if (Array.isArray(value)) return value.reduce((total, item) => total + countKeys(item, keys), 0);
  if (!value || typeof value !== 'object') return 0;
  return Object.entries(value as Record<string, unknown>).reduce((total, [key, nested]) => {
    const ownCount = keys.includes(key) && Array.isArray(nested) ? nested.length : 0;
    return total + ownCount + countKeys(nested, keys);
  }, 0);
}

function countTables(value: unknown): number {
  return countKeys(value, ['tables', 'table']) + countObjectsMatching(value, (record) => {
    const type = stringValue(record.type)?.toLowerCase();
    return type === 'table' || (type === 'list' && Array.isArray(record.cells));
  });
}

function countLineLikeItems(value: unknown): number {
  return countKeys(value, ['lines', 'line']) + countObjectsMatching(value, (record) => record.line_id !== undefined);
}

function countParagraphLikeItems(value: unknown): number {
  return (
    countKeys(value, ['paragraphs', 'paragraph']) +
    countObjectsMatching(value, (record) => {
      const type = stringValue(record.type)?.toLowerCase();
      return type === 'paragraph' || record.paragraph_id !== undefined;
    })
  );
}

function countObjectsMatching(
  value: unknown,
  predicate: (record: Record<string, unknown>) => boolean,
): number {
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + countObjectsMatching(item, predicate), 0);
  }
  if (!value || typeof value !== 'object') return 0;
  const record = value as Record<string, unknown>;
  const ownCount = predicate(record) ? 1 : 0;
  return (
    ownCount +
    Object.values(record).reduce<number>(
      (total, nested) => total + countObjectsMatching(nested, predicate),
      0,
    )
  );
}

function firstNumberByKeys(value: unknown, keys: string[]): number | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstNumberByKeys(item, keys);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (keys.includes(key)) {
      const parsed = typeof nested === 'number' ? nested : Number(nested);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    const found = firstNumberByKeys(nested, keys);
    if (found !== undefined) return found;
  }
  return undefined;
}

function parseArgs(argv: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = 'true';
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function parseMode(value?: string): SmokeMode {
  if (value === 'upload' || value === 'basic' || value === 'advanced' || value === 'admin' || value === 'async') {
    return value;
  }
  throw new Error('Invalid --mode. Use upload, basic, advanced, admin, or async');
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main()
  .catch(async (error) => {
    await audit(auditActions.SMARTREADER_OCR_FAILED, {
      error: error instanceof Error ? error.message : error,
    });
    console.error(redactSmartReaderSecrets(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

// Owns Event Registry roster extraction and review previews.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { FileStorageType, IndexingStatus, type IndexingJob, type Prisma } from '@prisma/client';
import { z } from 'zod';
import { env } from '../../../config/env';
import { prisma } from '../../../infrastructure/database/prisma';
import { auditActions } from '../../../shared/constants/application';
import { AppError } from '../../../shared/errors/app-error';
import { ErrorCodes } from '../../../shared/errors/error-codes';
import { readRosterTable, type RosterTableCell } from '../../../shared/utils/roster-table-reader';
import { createApplicationAudit } from '../../applications/application.helpers';
import { extractStructuredDocument } from '../../ai/openai-document-extraction';
import { StorageService } from '../../storage/storage.service';
import { downloadStoredObject } from '../../storage/storage-download';
import { getEventRosterFormat, type EventRosterFormat } from '../../event-registry/event-roster-format';

type EventRosterRow = Record<string, string | number | null>;

export type RosterPreviewResult = {
  rosterFileId: string;
  format: EventRosterFormat;
  columns: string[];
  sourceRows: EventRosterRow[];
  rows: EventRosterRow[];
  suggestedMapping: {
    studentCode: string;
    studentName: string;
    className: string;
    faculty: string;
    participationStatus: string;
    convertedValue: string;
  };
  quality: {
    rowCount: number;
    missingStudentCodeRows: number;
    missingStudentNameRows: number;
    duplicateStudentCodes: string[];
    confidence: number;
  };
  telemetry?: Prisma.JsonObject;
};

const storageService = new StorageService();
const eventRosterOutputSchema = z.object({
  columns: z.array(z.string().trim().min(1)).min(1),
  rows: z.array(z.array(z.string().nullable())),
}).strict().superRefine(({ columns, rows }, context) => {
  if (new Set(columns).size !== columns.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['columns'], message: 'Column names must be unique' });
  }
  rows.forEach((row, rowIndex) => {
    if (row.length !== columns.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rows', rowIndex],
        message: 'Every extracted row must align with the extracted columns',
      });
    }
  });
});
const eventRosterJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['columns', 'rows'],
  properties: {
    columns: { type: 'array', items: { type: 'string' } },
    rows: { type: 'array', items: { type: 'array', items: { type: ['string', 'null'] } } },
  },
};

export async function processEventRosterIndexingJob(job: IndexingJob): Promise<Prisma.InputJsonObject> {
  const eventFile = await prisma.eventFile.findUnique({
    where: { id: job.targetId },
    include: { file: true, event: true },
  });
  if (!eventFile) throw new AppError(404, ErrorCodes.EVENT_FILE_NOT_FOUND, 'Event roster file not found');
  assertCurrentTarget(job, eventFile);

  const started = await prisma.eventFile.updateMany({
    where: { id: eventFile.id, eventId: eventFile.eventId, fileId: eventFile.fileId },
    data: { indexingStatus: IndexingStatus.ocr_processing },
  });
  if (started.count !== 1) throw new AppError(409, ErrorCodes.CONFLICT, 'Event roster file changed before processing');

  try {
    const format = getEventRosterFormat(eventFile.file.originalName, eventFile.file.mimeType);
    const bytes = await readStoredFile(eventFile.file);
    const parsed = format === 'pdf'
      ? await parsePdfRoster(eventFile.id, bytes)
      : await readRosterTable({ buffer: bytes, format });
    if (parsed.columns.length === 0) {
      throw new AppError(422, ErrorCodes.ROSTER_PARSE_FAILED, 'Event roster contains no header row');
    }

    const columns = parsed.columns.map((column) => column.trim());
    if (columns.some((column) => !column) || new Set(columns).size !== columns.length) {
      throw new AppError(422, ErrorCodes.ROSTER_PARSE_FAILED, 'Event roster columns must be non-empty and unique');
    }
    const sourceRows = parsed.rows.map((row) => rowRecord(columns, row));
    const suggestedMapping = suggestMapping(columns);
    const quality = assessRows(sourceRows, suggestedMapping);
    const preview: RosterPreviewResult = {
      rosterFileId: eventFile.fileId,
      format,
      columns,
      sourceRows,
      rows: sourceRows,
      suggestedMapping,
      quality,
      ...('telemetry' in parsed && parsed.telemetry ? { telemetry: parsed.telemetry as unknown as Prisma.JsonObject } : {}),
    };

    await prisma.$transaction(async (tx) => {
      const current = await tx.eventFile.findUnique({
        where: { id: eventFile.id },
        include: { file: true, event: true },
      });
      if (!current || current.eventId !== eventFile.eventId || current.fileId !== eventFile.fileId) {
        throw new AppError(409, ErrorCodes.CONFLICT, 'Event roster file changed before processing');
      }
      assertCurrentTarget(job, current);
      if (current.event.rosterIndexed) {
        throw new AppError(409, ErrorCodes.CONFLICT, 'Confirmed event roster cannot be reprocessed');
      }
      const saved = await tx.eventFile.updateMany({
        where: {
          id: eventFile.id,
          eventId: eventFile.eventId,
          fileId: eventFile.fileId,
          indexingStatus: IndexingStatus.ocr_processing,
        },
        data: {
          indexingStatus: quality.rowCount === 0 || quality.missingStudentCodeRows > 0 ||
            quality.duplicateStudentCodes.length > 0 || quality.confidence < 0.6
            ? IndexingStatus.needs_manual_review
            : IndexingStatus.indexed,
          columnMappingJson: suggestedMapping,
          indexQualityScore: quality.confidence,
        },
      });
      if (saved.count !== 1) throw new AppError(409, ErrorCodes.CONFLICT, 'Event roster file changed before processing');

      await createApplicationAudit(tx, {
        actorId: current.event.createdBy,
        action: auditActions.EVENT_ROSTER_INDEXING_COMPLETED,
        targetType: 'event',
        targetId: current.eventId,
        afterStateJson: {
          eventFileId: current.id,
          rowCount: quality.rowCount,
          missingStudentCodeRows: quality.missingStudentCodeRows,
          duplicateStudentCodeCount: quality.duplicateStudentCodes.length,
          confidence: quality.confidence,
          ...(preview.telemetry ? { telemetry: preview.telemetry } : {}),
        },
        note: `Roster preview rows: ${quality.rowCount}`,
      });
    });
    return preview as unknown as Prisma.InputJsonObject;
  } catch (error) {
    const safeError = error instanceof AppError
      ? error
      : new AppError(422, ErrorCodes.ROSTER_PARSE_FAILED, 'Event roster could not be parsed');
    const code = safeError.code;
    await prisma.eventFile.updateMany({
      where: {
        id: eventFile.id,
        eventId: eventFile.eventId,
        fileId: eventFile.fileId,
        indexingStatus: IndexingStatus.ocr_processing,
      },
      data: { indexingStatus: IndexingStatus.failed },
    });
    await createApplicationAudit(prisma, {
      actorId: eventFile.event.createdBy,
      workspaceId: eventFile.event.workspaceId,
      action: auditActions.EVENT_ROSTER_INDEXING_FAILED,
      targetType: 'event',
      targetId: eventFile.eventId,
      afterStateJson: { eventFileId: eventFile.id, code },
    });
    throw safeError;
  }
}

function assertCurrentTarget(job: IndexingJob, eventFile: {
  id: string;
  fileId: string;
  file: { workspaceId: string | null };
  event: { workspaceId: string; rosterIndexed: boolean };
}) {
  if (
    job.targetId !== eventFile.id ||
    (job.workspaceId && job.workspaceId !== eventFile.event.workspaceId) ||
    eventFile.file.workspaceId !== eventFile.event.workspaceId
  ) {
    throw new AppError(404, ErrorCodes.EVENT_FILE_NOT_FOUND, 'Event roster file not found');
  }
}

async function readStoredFile(file: {
  storageType: FileStorageType;
  filePath: string;
}): Promise<Buffer> {
  if (file.storageType === FileStorageType.local) {
    const root = path.resolve(env.UPLOAD_DIR);
    const filePath = path.resolve(root, file.filePath);
    const relative = path.relative(root, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new AppError(404, ErrorCodes.FILE_NOT_FOUND, 'Roster file not found');
    }
    return fs.readFile(filePath);
  }
  const signedUrl = await storageService.getSignedReadUrl(file.filePath, 300, file.storageType);
  return downloadStoredObject(signedUrl, 'Roster file download failed');
}

async function parsePdfRoster(eventFileId: string, bytes: Buffer) {
  const result = await extractStructuredDocument({
    useCase: 'event_roster',
    model: env.OPENAI_EVENT_ROSTER_MODEL,
    promptVersion: env.OPENAI_EVENT_ROSTER_PROMPT_VERSION,
    instructions: [
      'Extract the visible column headings and every roster row from this event roster PDF.',
      'Transcribe only visible values. Do not infer or complete identity or attendance values.',
      'Preserve student codes exactly as printed, including leading zeros. Return blank cells as null.',
      'Each row must contain exactly one cell per column. Do not confirm or determine eligibility.',
    ].join('\n'),
    schemaName: 'event_roster_table',
    outputSchema: eventRosterJsonSchema,
    validate: (value) => eventRosterOutputSchema.parse(value),
    content: [{ type: 'input_file', filename: 'event-roster.pdf', file_data: `data:application/pdf;base64,${bytes.toString('base64')}` }],
    timeoutMs: env.OPENAI_DOCUMENT_EXTRACTION_TIMEOUT_MS,
    maxRetries: env.OPENAI_DOCUMENT_EXTRACTION_MAX_RETRIES,
    entity: { type: 'event_file', id: eventFileId },
    maxOutputTokens: 8000,
  });
  return {
    columns: result.data.columns,
    rows: result.data.rows.map((row) => row.map((cell) => cell ?? '')),
    telemetry: result.telemetry,
  };
}

function rowRecord(columns: string[], row: RosterTableCell[]): EventRosterRow {
  return Object.fromEntries(columns.map((column, index) => [column, jsonCell(row[index] ?? null)]));
}

function jsonCell(value: RosterTableCell): string | number | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return value;
}

function suggestMapping(columns: string[]): RosterPreviewResult['suggestedMapping'] {
  const find = (pattern: RegExp) => columns.find((column) => pattern.test(normalizeHeader(column))) ?? '';
  return {
    studentCode: find(/mssv|masinhvien|studentcode|studentid/) || columns[0] || '',
    studentName: find(/hoten|hovaten|fullname|studentname|ten sinh vien/),
    className: find(/lop|class/),
    faculty: find(/khoa|faculty|school/),
    participationStatus: find(/trangthai|attendance|participation|status/),
    convertedValue: find(/songay|convertedvalue|diem/),
  };
}

function normalizeHeader(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function assessRows(rows: EventRosterRow[], mapping: RosterPreviewResult['suggestedMapping']): RosterPreviewResult['quality'] {
  const codes = rows.map((row) => String(row[mapping.studentCode] ?? '').trim()).filter(Boolean);
  const duplicateStudentCodes = [...new Set(codes.filter((code, index) => codes.indexOf(code) !== index))];
  const missingStudentCodeRows = rows.filter((row) => !String(row[mapping.studentCode] ?? '').trim()).length;
  const missingStudentNameRows = mapping.studentName
    ? rows.filter((row) => !String(row[mapping.studentName] ?? '').trim()).length
    : rows.length;
  const confidence = rows.length === 0 ? 0.2
    : duplicateStudentCodes.length > 0 || missingStudentCodeRows > 0 || missingStudentNameRows > 0 ? 0.55 : 0.9;
  return { rowCount: rows.length, missingStudentCodeRows, missingStudentNameRows, duplicateStudentCodes, confidence };
}

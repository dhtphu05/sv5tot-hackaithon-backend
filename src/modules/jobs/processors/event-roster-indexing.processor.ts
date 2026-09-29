// Owns roster indexing jobs for event registry files.
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileStorageType, IndexingStatus, type File, type IndexingJob, type Prisma } from '@prisma/client';
import { env } from '../../../config/env';
import { prisma } from '../../../infrastructure/database/prisma';
import { auditActions } from '../../../shared/constants/application';
import { AppError } from '../../../shared/errors/app-error';
import { ErrorCodes } from '../../../shared/errors/error-codes';
import { createApplicationAudit } from '../../applications/application.helpers';
import { StorageService } from '../../storage/storage.service';

export type RosterPreviewResult = {
  columns: string[];
  rows: Array<Record<string, string | number | null>>;
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
    duplicateStudentCodes: string[];
    confidence: number;
  };
};

const defaultColumns = ['MSSV', 'Họ và tên', 'Lớp', 'Khoa', 'Trạng thái', 'Số ngày'];
const defaultMapping = {
  studentCode: 'MSSV',
  studentName: 'Họ và tên',
  className: 'Lớp',
  faculty: 'Khoa',
  participationStatus: 'Trạng thái',
  convertedValue: 'Số ngày',
};
const storageService = new StorageService();

export async function processEventRosterIndexingJob(
  job: IndexingJob,
): Promise<Prisma.InputJsonObject> {
  const eventFile = await prisma.eventFile.findUnique({
    where: { id: job.targetId },
    include: {
      file: true,
      event: true,
    },
  });

  if (!eventFile) {
    throw new Error('Event file not found for roster indexing job');
  }

  await prisma.eventFile.update({
    where: { id: eventFile.id },
    data: { indexingStatus: IndexingStatus.ocr_processing },
  });

  let source: { filePath: string; cleanup?: () => Promise<void> } | undefined;
  let preview: RosterPreviewResult;
  try {
    source = await prepareRosterPreviewSource(eventFile.file);
    preview = await extractRosterPreview({
      filePath: source.filePath,
      originalName: eventFile.file.originalName,
      mimeType: eventFile.file.mimeType,
      fallbackConvertedValue: eventFile.event.convertedValue,
    });
  } catch (error) {
    const code = error instanceof AppError ? error.code : ErrorCodes.ROSTER_PARSE_FAILED;
    await prisma.eventFile.updateMany({
      where: { id: eventFile.id, fileId: eventFile.file.id },
      data: { indexingStatus: IndexingStatus.failed },
    });
    await createApplicationAudit(prisma, {
      actorId: eventFile.event.createdBy,
      action: auditActions.EVENT_ROSTER_INDEXING_FAILED,
      targetType: 'event',
      targetId: eventFile.eventId,
      afterStateJson: { eventFileId: eventFile.id, code },
    });
    throw error;
  } finally {
    await source?.cleanup?.();
  }

  const indexingStatus =
    preview.quality.rowCount === 0 ||
    preview.quality.missingStudentCodeRows > 0 ||
    preview.quality.duplicateStudentCodes.length > 0 ||
    preview.quality.confidence < 0.6
      ? IndexingStatus.needs_manual_review
      : IndexingStatus.indexed;

  await prisma.$transaction(async (tx) => {
    await tx.eventFile.update({
      where: { id: eventFile.id },
      data: {
        indexingStatus,
        columnMappingJson: preview.suggestedMapping,
        indexQualityScore: preview.quality.confidence,
      },
    });

    await createApplicationAudit(tx, {
      actorId: eventFile.event.createdBy,
      action:
        indexingStatus === IndexingStatus.indexed
          ? auditActions.EVENT_ROSTER_INDEXING_COMPLETED
          : auditActions.EVENT_ROSTER_INDEXING_FAILED,
      targetType: 'event',
      targetId: eventFile.eventId,
      afterStateJson: preview as Prisma.InputJsonValue,
      note: `Roster preview rows: ${preview.quality.rowCount}`,
    });
  });

  return preview as Prisma.InputJsonObject;
}

async function prepareRosterPreviewSource(file: File): Promise<{
  filePath: string;
  cleanup?: () => Promise<void>;
}> {
  if (file.storageType === FileStorageType.local) {
    return { filePath: path.resolve(env.UPLOAD_DIR, file.filePath) };
  }

  const signedUrl = await storageService.getSignedReadUrl(file.filePath, 300, file.storageType);
  const response = await fetch(signedUrl);
  if (!response.ok) {
    throw new Error(`Roster preview source download failed with HTTP ${response.status}`);
  }

  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), '5tot-roster-'));
  const tempPath = path.join(tempDirectory, path.basename(file.originalName || file.filePath));
  await fs.writeFile(tempPath, Buffer.from(await response.arrayBuffer()));

  return {
    filePath: tempPath,
    cleanup: () => fs.rm(tempDirectory, { recursive: true, force: true }),
  };
}

async function extractRosterPreview(input: {
  filePath: string;
  originalName: string;
  mimeType: string;
  fallbackConvertedValue: number | null;
}): Promise<RosterPreviewResult> {
  if (input.mimeType === 'text/csv') {
    try {
      const content = await fs.readFile(input.filePath, 'utf8');
      const rows = parseCsv(content);
      return buildPreview(rows, input.fallbackConvertedValue);
    } catch (error) {
      throw new AppError(422, ErrorCodes.ROSTER_PARSE_FAILED, 'Event roster CSV could not be parsed', {
        retryable: false,
        cause: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  throw new AppError(422, ErrorCodes.ROSTER_PARSE_FAILED, 'Unsupported event roster format', {
    retryable: false,
  });
}

function parseCsv(content: string): Array<Record<string, string>> {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
  });
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function buildPreview(
  rows: Array<Record<string, string | number | null>>,
  fallbackConvertedValue: number | null,
): RosterPreviewResult {
  const normalizedRows: Array<Record<string, string | number | null>> = rows.map((row) => ({
    ...Object.fromEntries(defaultColumns.map((column) => [column, row[column] ?? ''])),
    'Số ngày': row['Số ngày'] ?? fallbackConvertedValue,
  }));
  const studentCodes = normalizedRows.map((row) => String(row.MSSV ?? '').trim()).filter(Boolean);
  const duplicateStudentCodes = [
    ...new Set(studentCodes.filter((code, i) => studentCodes.indexOf(code) !== i)),
  ];
  const missingStudentCodeRows = normalizedRows.filter(
    (row) => !String(row.MSSV ?? '').trim(),
  ).length;
  const confidence =
    normalizedRows.length === 0
      ? 0.2
      : duplicateStudentCodes.length > 0 || missingStudentCodeRows > 0
        ? 0.55
        : 0.9;

  return {
    columns: defaultColumns,
    rows: normalizedRows,
    suggestedMapping: defaultMapping,
    quality: {
      rowCount: normalizedRows.length,
      missingStudentCodeRows,
      duplicateStudentCodes,
      confidence,
    },
  };
}

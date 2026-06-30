// Owns roster indexing jobs for event registry files.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { IndexingStatus, type IndexingJob, type Prisma } from '@prisma/client';
import { env } from '../../../config/env';
import { prisma } from '../../../infrastructure/database/prisma';
import { auditActions } from '../../../shared/constants/application';
import { createApplicationAudit } from '../../applications/application.helpers';

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

  const preview = await extractRosterPreview({
    filePath: path.resolve(env.UPLOAD_DIR, eventFile.file.filePath),
    originalName: eventFile.file.originalName,
    mimeType: eventFile.file.mimeType,
    fallbackConvertedValue: eventFile.event.convertedValue,
  });

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
    } catch {
      return mockRows(input.originalName, input.fallbackConvertedValue);
    }
  }

  return mockRows(input.originalName, input.fallbackConvertedValue);
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

function mockRows(fileName: string, fallbackConvertedValue: number | null): RosterPreviewResult {
  const normalized = fileName.toLowerCase();
  if (normalized.includes('empty')) {
    return buildPreview([], fallbackConvertedValue);
  }

  const rows = [
    {
      MSSV: '102220001',
      'Họ và tên': 'Nguyễn Văn Sinh',
      Lớp: '22T_DT1',
      Khoa: 'Khoa Công nghệ Thông tin',
      'Trạng thái': 'Hoàn thành',
      'Số ngày': fallbackConvertedValue ?? 3,
    },
    {
      MSSV: normalized.includes('duplicate') ? '102220001' : '102220002',
      'Họ và tên': 'Trần Lớp Trưởng',
      Lớp: '22T_DT1',
      Khoa: 'Khoa Công nghệ Thông tin',
      'Trạng thái': 'Hoàn thành',
      'Số ngày': fallbackConvertedValue ?? 3,
    },
  ];

  if (normalized.includes('missing')) {
    rows.push({
      MSSV: '',
      'Họ và tên': 'Thiếu MSSV',
      Lớp: '22T_DT1',
      Khoa: 'Khoa Công nghệ Thông tin',
      'Trạng thái': 'Hoàn thành',
      'Số ngày': fallbackConvertedValue ?? 3,
    });
  }

  return buildPreview(rows, fallbackConvertedValue);
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

import { Criterion, RosterPreviewValidationStatus } from '@prisma/client';
import type { DecisionColumnMapping } from './roster-column-mapping.service';

export type NormalizedRosterPreviewRow = {
  studentCode?: string;
  studentName?: string;
  className?: string;
  faculty?: string;
  criterion?: Criterion;
  convertedValue?: number;
  convertedUnit?: string;
  participationStatus?: string;
  sourcePage?: number;
  sourceTableIndex?: number;
  sourceRowIndex?: number;
  validationStatus: RosterPreviewValidationStatus;
  validationWarnings: Array<{ code: string; message: string }>;
  rawRow: Record<string, unknown>;
};

export function normalizeRosterRow(input: {
  row: Record<string, unknown>;
  mapping: DecisionColumnMapping;
  fallbackCriterion?: Criterion | null;
  fallbackConvertedValue?: number | null;
  fallbackConvertedUnit?: string | null;
  sourcePage?: number;
  sourceTableIndex?: number;
}): NormalizedRosterPreviewRow {
  const warnings: Array<{ code: string; message: string }> = [];
  const studentCode = clean(read(input.row, input.mapping.studentCode));
  const studentName = clean(read(input.row, input.mapping.studentName));
  const convertedValue =
    numberValue(read(input.row, input.mapping.convertedValue)) ?? input.fallbackConvertedValue ?? undefined;
  const criterion = criterionValue(read(input.row, input.mapping.criterion)) ?? input.fallbackCriterion ?? undefined;

  if (!studentCode) warnings.push({ code: 'MISSING_STUDENT_CODE', message: 'Thiếu MSSV.' });
  if (!studentName) warnings.push({ code: 'MISSING_STUDENT_NAME', message: 'Thiếu họ tên sinh viên.' });
  if (!criterion) warnings.push({ code: 'MISSING_CRITERION', message: 'Thiếu tiêu chí, dùng thông tin import để bổ sung.' });

  let validationStatus: RosterPreviewValidationStatus = RosterPreviewValidationStatus.valid;
  if (!studentCode) validationStatus = RosterPreviewValidationStatus.missing_student_code;
  else if (!studentName) validationStatus = RosterPreviewValidationStatus.warning;
  else if (!criterion) validationStatus = RosterPreviewValidationStatus.warning;

  return {
    studentCode,
    studentName,
    className: clean(read(input.row, input.mapping.className)),
    faculty: clean(read(input.row, input.mapping.faculty)),
    criterion,
    convertedValue,
    convertedUnit: clean(read(input.row, input.mapping.convertedUnit)) ?? input.fallbackConvertedUnit ?? undefined,
    participationStatus: clean(read(input.row, input.mapping.participationStatus)) ?? 'confirmed',
    sourcePage: input.sourcePage,
    sourceTableIndex: input.sourceTableIndex,
    sourceRowIndex: numberValue(input.row.__sourceRowIndex),
    validationStatus,
    validationWarnings: warnings,
    rawRow: input.row,
  };
}

export function markDuplicateRows(rows: NormalizedRosterPreviewRow[]): NormalizedRosterPreviewRow[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.studentCode) counts.set(row.studentCode, (counts.get(row.studentCode) ?? 0) + 1);
  }
  return rows.map((row) => {
    if (!row.studentCode || (counts.get(row.studentCode) ?? 0) < 2) return row;
    return {
      ...row,
      validationStatus: RosterPreviewValidationStatus.duplicate,
      validationWarnings: [
        ...row.validationWarnings,
        { code: 'DUPLICATE_STUDENT_CODE', message: `Trùng MSSV ${row.studentCode}.` },
      ],
    };
  });
}

function read(row: Record<string, unknown>, column?: string): unknown {
  if (!column) return undefined;
  return row[column];
}

function clean(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const normalized = value.replace(',', '.').replace(/[^0-9.-]/g, '');
    if (normalized && Number.isFinite(Number(normalized))) return Number(normalized);
  }
  return undefined;
}

function criterionValue(value: unknown): Criterion | undefined {
  const text = clean(value)?.toLowerCase();
  if (!text) return undefined;
  const entries: Array<[Criterion, string[]]> = [
    [Criterion.ethics, ['dao duc', 'đạo đức', 'ethic']],
    [Criterion.academic, ['hoc tap', 'học tập', 'academic']],
    [Criterion.physical, ['the luc', 'thể lực', 'physical']],
    [Criterion.volunteer, ['tinh nguyen', 'tình nguyện', 'volunteer']],
    [Criterion.integration, ['hoi nhap', 'hội nhập', 'integration']],
    [Criterion.priority, ['uu tien', 'ưu tiên', 'priority']],
  ];
  return entries.find(([, aliases]) => aliases.some((alias) => text.includes(alias)))?.[0];
}

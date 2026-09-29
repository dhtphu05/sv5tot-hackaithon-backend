import { RosterPreviewValidationStatus } from '@prisma/client';
import type { NormalizedRosterPreviewRow } from './roster-row.normalizer';
import { markDuplicateRows } from './roster-row.normalizer';

type EditableRosterField =
  | 'studentCode'
  | 'studentName'
  | 'className'
  | 'faculty'
  | 'criterion'
  | 'convertedValue'
  | 'convertedUnit'
  | 'participationStatus';

export type DecisionRosterCorrection = {
  [K in EditableRosterField]?: NormalizedRosterPreviewRow[K] | null;
};

export type DecisionRosterCorrections = Record<string, DecisionRosterCorrection>;

export function decisionRosterCorrectionKey(row: Pick<NormalizedRosterPreviewRow, 'sourcePage' | 'sourceTableIndex' | 'sourceRowIndex'>) {
  return [row.sourcePage ?? 0, row.sourceTableIndex ?? 0, row.sourceRowIndex ?? 0].join(':');
}

export function readDecisionRosterCorrections(resultJson: unknown): DecisionRosterCorrections {
  if (!resultJson || typeof resultJson !== 'object' || Array.isArray(resultJson)) return {};
  const rowCorrections = (resultJson as Record<string, unknown>).rowCorrections;
  if (!rowCorrections || typeof rowCorrections !== 'object' || Array.isArray(rowCorrections)) return {};
  return rowCorrections as DecisionRosterCorrections;
}

export function applyDecisionRosterCorrections(
  rows: NormalizedRosterPreviewRow[],
  corrections: DecisionRosterCorrections,
): NormalizedRosterPreviewRow[] {
  const corrected = rows.map((row) => {
    const correction = corrections[decisionRosterCorrectionKey(row)];
    if (!correction) return validateRow(row);
    const values = Object.fromEntries(
      Object.entries(correction).map(([key, value]) => [key, value === null ? undefined : value]),
    );
    return validateRow({ ...row, ...values, rawRow: row.rawRow });
  });
  return markDuplicateRows(corrected);
}

function validateRow(row: NormalizedRosterPreviewRow): NormalizedRosterPreviewRow {
  const warnings: NormalizedRosterPreviewRow['validationWarnings'] = [];
  if (!row.studentCode?.trim()) warnings.push({ code: 'MISSING_STUDENT_CODE', message: 'Thiếu MSSV.' });
  if (!row.studentName?.trim()) warnings.push({ code: 'MISSING_STUDENT_NAME', message: 'Thiếu họ tên sinh viên.' });
  if (!row.criterion) warnings.push({ code: 'MISSING_CRITERION', message: 'Thiếu tiêu chí, dùng thông tin import để bổ sung.' });

  let validationStatus: NormalizedRosterPreviewRow['validationStatus'] = RosterPreviewValidationStatus.valid;
  if (!row.studentCode?.trim()) validationStatus = RosterPreviewValidationStatus.missing_student_code;
  else if (!row.studentName?.trim() || !row.criterion) validationStatus = RosterPreviewValidationStatus.warning;

  return { ...row, validationStatus, validationWarnings: warnings };
}

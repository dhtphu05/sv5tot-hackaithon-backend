import { AwardLevel, AwardRecipientMatchStatus } from '@prisma/client';
import { normalizeText } from '../decision-imports/decision-ocr-table-normalizer';
import { suggestRosterColumnMapping } from '../decision-imports/roster-column-mapping.service';

export type AwardRosterMapping = {
  studentCode: string;
  fullName: string;
  className?: string;
  institution?: string;
};

export type AwardRosterInstitution = {
  id: string;
  code: string | null;
  name: string;
  shortName: string | null;
  aliases: string[];
};

export type AwardRosterSourceCell =
  | string
  | number
  | boolean
  | Date
  | { __cellType: 'date'; value: string }
  | null;
export type AwardRosterSourceRow = AwardRosterSourceCell[];

export type AwardRosterPreviewRow = {
  sourceRow: number;
  studentCode: string | null;
  fullName: string | null;
  className: string | null;
  institutionText: string | null;
  institutionWorkspaceId: string | null;
  matchStatus: AwardRecipientMatchStatus;
  matchedUserId: string | null;
  status: 'VALID' | 'INVALID' | 'DUPLICATE' | 'CONFLICT';
  errors: string[];
};

export type AwardRosterPreview = {
  rows: AwardRosterPreviewRow[];
  summary: {
    total: number;
    valid: number;
    invalid: number;
    duplicate: number;
    conflict: number;
    matched: number;
    unmatched: number;
  };
};

export type AwardRosterMappingContext = {
  awardLevel: AwardLevel;
  issuer: AwardRosterInstitution;
  institutions: AwardRosterInstitution[];
  users: Array<{ id: string; studentCode: string | null; workspaceId: string | null }>;
};

export function suggestAwardRosterMapping(columns: string[]): AwardRosterMapping {
  const table = { tableIndex: 0, header: columns, rows: [], rawRows: [] };
  const suggested = suggestRosterColumnMapping(table);
  const code = columns.find((column) => matches(normalizeText(column), [/mssv/, /ma sinh vien/, /ma sv/, /student code/, /student id/, /^ms$/]));
  const name = columns.find((column) => matches(normalizeText(column), [/ho ten/, /ho va ten/, /full name/, /student name/, /^name$/]));
  const className = columns.find((column) => matches(normalizeText(column), [/lop/, /class/])) ?? suggested.className;
  const institution = columns.find((column) => matches(normalizeText(column), [/truong/, /school/, /university/, /institution/, /co so dao tao/]));

  return {
    studentCode: code ?? '',
    fullName: name ?? suggested.studentName ?? '',
    ...(className ? { className } : {}),
    ...(institution ? { institution } : {}),
  };
}

export function getAwardRosterFormat(originalName: string, mimeType: string): 'csv' | 'xlsx' | 'pdf' {
  const dot = originalName.lastIndexOf('.');
  const extension = dot < 0 ? '' : originalName.toLowerCase().slice(dot);
  if (extension === '.xls' || mimeType === 'application/vnd.ms-excel') {
    throw new Error('Legacy XLS roster files are not supported');
  }
  if (mimeType === 'text/csv' && (extension === '.csv' || !extension)) return 'csv';
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' &&
    (extension === '.xlsx' || !extension)
  ) {
    return 'xlsx';
  }
  if (mimeType === 'application/pdf' && (extension === '.pdf' || !extension)) return 'pdf';
  throw new Error('Roster must be CSV, XLSX, or PDF');
}

export function validateAwardRosterMapping(columns: string[], mapping: AwardRosterMapping): boolean {
  const selected = [mapping.studentCode, mapping.fullName, mapping.className, mapping.institution].filter(Boolean);
  return Boolean(
    mapping.studentCode &&
      mapping.fullName &&
      new Set(selected).size === selected.length &&
      columns.includes(mapping.studentCode) &&
      columns.includes(mapping.fullName) &&
      selected.every((column) => columns.includes(column!)),
  );
}

export function buildAwardRosterPreview(input: {
  columns: string[];
  sourceRows: AwardRosterSourceRow[];
  mapping: AwardRosterMapping;
  context: AwardRosterMappingContext;
}): AwardRosterPreview {
  const rows = input.sourceRows
    .filter((row) => row.some((cell) => cell !== null && String(cell).trim() !== ''))
    .map((source, index) => buildRow(input, source, index + 2));

  const duplicateCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.status !== 'VALID' || !row.studentCode || !row.institutionWorkspaceId) continue;
    const key = `${row.institutionWorkspaceId}\u0000${row.studentCode}`;
    duplicateCounts.set(key, (duplicateCounts.get(key) ?? 0) + 1);
  }
  for (const row of rows) {
    if (row.status !== 'VALID' || !row.studentCode || !row.institutionWorkspaceId) continue;
    const key = `${row.institutionWorkspaceId}\u0000${row.studentCode}`;
    if ((duplicateCounts.get(key) ?? 0) > 1) row.status = 'DUPLICATE';
  }

  return {
    rows,
    summary: {
      total: rows.length,
      valid: rows.filter((row) => row.status === 'VALID').length,
      invalid: rows.filter((row) => row.status === 'INVALID').length,
      duplicate: rows.filter((row) => row.status === 'DUPLICATE').length,
      conflict: rows.filter((row) => row.status === 'CONFLICT').length,
      matched: rows.filter((row) => row.matchStatus === AwardRecipientMatchStatus.MATCHED).length,
      unmatched: rows.filter((row) => row.matchStatus === AwardRecipientMatchStatus.UNMATCHED).length,
    },
  };
}

function buildRow(
  input: {
    columns: string[];
    mapping: AwardRosterMapping;
    context: AwardRosterMappingContext;
  },
  source: AwardRosterSourceRow,
  sourceRow: number,
): AwardRosterPreviewRow {
  const errors: string[] = [];
  const codeCell = valueAt(input.columns, source, input.mapping.studentCode);
  const studentCode = typeof codeCell === 'string' ? clean(codeCell) : null;
  const fullName = clean(valueAt(input.columns, source, input.mapping.fullName));
  const className = clean(valueAt(input.columns, source, input.mapping.className));
  const institutionText = clean(valueAt(input.columns, source, input.mapping.institution));

  if (codeCell === null || codeCell === undefined || (typeof codeCell === 'string' && !codeCell.trim())) {
    errors.push('STUDENT_CODE_REQUIRED');
  } else if (typeof codeCell !== 'string') {
    errors.push('STUDENT_CODE_MUST_BE_TEXT');
  }
  if (!fullName) errors.push('FULL_NAME_REQUIRED');

  const institutionWorkspaceId = resolveInstitution(input.context, input.mapping, institutionText);
  let matchStatus: AwardRecipientMatchStatus = AwardRecipientMatchStatus.UNMATCHED;
  if (!institutionWorkspaceId) {
    errors.push('INSTITUTION_CONTEXT_UNRESOLVED');
    matchStatus = AwardRecipientMatchStatus.CONFLICT;
  }

  const status = errors.some((error) => error === 'STUDENT_CODE_REQUIRED' || error === 'STUDENT_CODE_MUST_BE_TEXT' || error === 'FULL_NAME_REQUIRED')
    ? 'INVALID'
    : !institutionWorkspaceId
      ? 'CONFLICT'
      : 'VALID';
  const matchedUser =
    status === 'INVALID' || status === 'CONFLICT'
      ? null
      : input.context.users.find(
          (user) => user.workspaceId === institutionWorkspaceId && user.studentCode === studentCode,
        ) ?? null;
  if (matchedUser) matchStatus = AwardRecipientMatchStatus.MATCHED;

  return {
    sourceRow,
    studentCode,
    fullName,
    className,
    institutionText,
    institutionWorkspaceId,
    matchStatus,
    matchedUserId: matchedUser?.id ?? null,
    status,
    errors,
  };
}

function resolveInstitution(
  context: AwardRosterMappingContext,
  mapping: AwardRosterMapping,
  institutionText: string | null,
): string | null {
  if (context.awardLevel === AwardLevel.SCHOOL) {
    if (!mapping.institution) return context.issuer.id;
    return institutionText && institutionMatches(institutionText, context.issuer)
      ? context.issuer.id
      : null;
  }
  if (!mapping.institution || !institutionText) return null;

  const matches = context.institutions.filter((institution) => institutionMatches(institutionText, institution));
  const distinctIds = [...new Set(matches.map((institution) => institution.id))];
  return distinctIds.length === 1 ? distinctIds[0]! : null;
}

function institutionMatches(value: string, institution: AwardRosterInstitution): boolean {
  const key = normalizeText(value);
  if (!key) return false;
  return [institution.code, institution.name, institution.shortName, ...institution.aliases]
    .filter((candidate): candidate is string => Boolean(candidate))
    .some((candidate) => normalizeText(candidate) === key);
}

function valueAt(columns: string[], row: AwardRosterSourceRow, column?: string): unknown {
  if (!column) return undefined;
  const index = columns.indexOf(column);
  return index < 0 ? undefined : row[index];
}

function clean(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value === 'object' &&
    '__cellType' in value &&
    value.__cellType === 'date' &&
    'value' in value &&
    typeof value.value === 'string'
  ) {
    return value.value.trim() || null;
  }
  const text = String(value).trim();
  return text || null;
}

function matches(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

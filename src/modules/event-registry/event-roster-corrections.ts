import type { NormalizedParticipantInput } from './event-participant.normalizer';

export type EventRosterRowCorrection = {
  studentCode?: string;
  studentName?: string;
  className?: string | null;
  faculty?: string | null;
  participationStatus?: string | null;
  convertedValue?: number | null;
};

export type EventRosterCorrections = Record<string, EventRosterRowCorrection>;

const correctionFields = new Set([
  'studentCode',
  'studentName',
  'className',
  'faculty',
  'participationStatus',
  'convertedValue',
]);

export function readEventRosterCorrections(value: unknown): EventRosterCorrections {
  const result = asRecord(value);
  const corrections = asRecord(result?.rowCorrections);
  if (!corrections) return {};
  const parsed: EventRosterCorrections = {};
  for (const [rowNumber, rawCorrection] of Object.entries(corrections)) {
    if (!/^[2-9]\d*$/.test(rowNumber)) continue;
    const correction = asRecord(rawCorrection);
    if (!correction) continue;
    const fields: EventRosterRowCorrection = {};
    for (const [field, rawValue] of Object.entries(correction)) {
      if (!correctionFields.has(field)) continue;
      if (field === 'convertedValue') {
        if (rawValue === null || (typeof rawValue === 'number' && Number.isFinite(rawValue) && rawValue >= 0)) {
          fields.convertedValue = rawValue as number | null;
        }
        continue;
      }
      if (rawValue !== null && typeof rawValue !== 'string') continue;
      const normalized = typeof rawValue === 'string' ? rawValue.trim() : null;
      if (field === 'studentCode') {
        if (normalized) fields.studentCode = normalized;
      } else if (field === 'studentName') {
        if (normalized) fields.studentName = normalized;
      } else if (field === 'className') fields.className = normalized;
      else if (field === 'faculty') fields.faculty = normalized;
      else if (field === 'participationStatus') fields.participationStatus = normalized;
    }
    if (Object.keys(fields).length) parsed[rowNumber] = fields;
  }
  return parsed;
}

export function addEventRosterCorrection(
  corrections: EventRosterCorrections,
  rowNumber: number,
  correction: EventRosterRowCorrection,
): EventRosterCorrections {
  assertSourceRowNumber(rowNumber);
  if (!Object.keys(correction).length) throw new Error('At least one roster correction field is required');
  return { ...corrections, [String(rowNumber)]: { ...(corrections[String(rowNumber)] ?? {}), ...correction } };
}

export function removeEventRosterCorrection(corrections: EventRosterCorrections, rowNumber: number): EventRosterCorrections {
  assertSourceRowNumber(rowNumber);
  const { [String(rowNumber)]: _removed, ...remaining } = corrections;
  return remaining;
}

export function applyEventRosterCorrections<T extends NormalizedParticipantInput>(
  participants: T[],
  corrections: EventRosterCorrections,
): T[] {
  return participants.map((participant, index) => {
    const correction = corrections[String(index + 2)];
    if (!correction) return participant;
    return {
      ...participant,
      ...(correction.studentCode !== undefined ? { studentCode: correction.studentCode.trim() } : {}),
      ...(correction.studentName !== undefined ? { studentName: correction.studentName.trim() } : {}),
      ...(correction.className !== undefined ? { className: correction.className?.trim() || null } : {}),
      ...(correction.faculty !== undefined ? { faculty: correction.faculty?.trim() || null } : {}),
      ...(correction.participationStatus !== undefined
        ? { participationStatus: correction.participationStatus?.trim() || 'confirmed' }
        : {}),
      ...(correction.convertedValue !== undefined ? { convertedValue: correction.convertedValue } : {}),
    };
  });
}

export function applyEventRosterCorrection<T extends NormalizedParticipantInput>(
  participant: T,
  correction?: EventRosterRowCorrection,
): T {
  if (!correction) return participant;
  return {
    ...participant,
    ...(correction.studentCode !== undefined ? { studentCode: correction.studentCode.trim() } : {}),
    ...(correction.studentName !== undefined ? { studentName: correction.studentName.trim() } : {}),
    ...(correction.className !== undefined ? { className: correction.className?.trim() || null } : {}),
    ...(correction.faculty !== undefined ? { faculty: correction.faculty?.trim() || null } : {}),
    ...(correction.participationStatus !== undefined
      ? { participationStatus: correction.participationStatus?.trim() || 'confirmed' }
      : {}),
    ...(correction.convertedValue !== undefined ? { convertedValue: correction.convertedValue } : {}),
  };
}

export function rebuildEventRosterPreviewRows(
  sourceRows: Array<Record<string, string | number | null>>,
  corrections: EventRosterCorrections,
  mapping: {
    studentCode: string;
    studentName: string;
    className: string;
    faculty: string;
    participationStatus: string;
    convertedValue: string;
  },
) {
  const rows = sourceRows.map((sourceRow, index) => {
    const correction = corrections[String(index + 2)];
    if (!correction) return { ...sourceRow };
    const row = { ...sourceRow };
    const mappedFields = {
      studentCode: mapping.studentCode,
      studentName: mapping.studentName,
      className: mapping.className,
      faculty: mapping.faculty,
      participationStatus: mapping.participationStatus,
      convertedValue: mapping.convertedValue,
    } as const;
    for (const [field, column] of Object.entries(mappedFields)) {
      if (correction[field as keyof EventRosterRowCorrection] !== undefined && column) {
        row[column] = correction[field as keyof EventRosterRowCorrection] as string | number | null;
      }
    }
    return row;
  });
  const codes = sourceRows.map((row, index) => {
    const correction = corrections[String(index + 2)];
    return String(correction?.studentCode ?? row[mapping.studentCode] ?? '').trim();
  }).filter(Boolean);
  const duplicateStudentCodes = [...new Set(codes.filter((code, index) => codes.indexOf(code) !== index))];
  const missingStudentCodeRows = sourceRows.filter((row, index) => {
    const correction = corrections[String(index + 2)];
    return !String(correction?.studentCode ?? row[mapping.studentCode] ?? '').trim();
  }).length;
  const missingStudentNameRows = sourceRows.filter((row, index) => {
    const correction = corrections[String(index + 2)];
    return !String(correction?.studentName ?? (mapping.studentName ? row[mapping.studentName] : '') ?? '').trim();
  }).length;
  const confidence = sourceRows.length === 0 ? 0.2
    : duplicateStudentCodes.length || missingStudentCodeRows || missingStudentNameRows ? 0.55 : 0.9;
  return {
    rows,
    quality: {
      rowCount: sourceRows.length,
      missingStudentCodeRows,
      missingStudentNameRows,
      duplicateStudentCodes,
      confidence,
    },
  };
}

export function findDuplicateEventStudentCodes(participants: NormalizedParticipantInput[]): string[] {
  const codes = participants.map((participant) => participant.studentCode.trim()).filter(Boolean);
  return [...new Set(codes.filter((code, index) => codes.indexOf(code) !== index))];
}

function assertSourceRowNumber(rowNumber: number) {
  if (!Number.isInteger(rowNumber) || rowNumber < 2) throw new Error('Roster row number must be at least 2');
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

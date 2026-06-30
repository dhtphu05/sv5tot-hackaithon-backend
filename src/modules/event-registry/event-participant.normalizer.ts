export type RosterColumnMapping = {
  studentCode: string;
  studentName?: string;
  className?: string;
  faculty?: string;
  participationStatus?: string;
  convertedValue?: string;
};

export type NormalizedParticipantInput = {
  studentCode: string;
  studentName: string;
  className: string | null;
  faculty: string | null;
  participationStatus: string;
  convertedValue: number | null;
};

export function normalizeStudentCode(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeVietnameseName(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeParticipationStatus(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return normalized || 'confirmed';
}

export function parseConvertedValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

export function applyColumnMapping(
  row: Record<string, unknown>,
  mapping: RosterColumnMapping,
  eventFallback: { convertedValue: number | null },
): NormalizedParticipantInput | null {
  const studentCode = normalizeStudentCode(row[mapping.studentCode]);
  if (!studentCode) return null;

  const convertedValue =
    parseConvertedValue(mapping.convertedValue ? row[mapping.convertedValue] : undefined) ??
    eventFallback.convertedValue;

  return {
    studentCode,
    studentName: normalizeVietnameseName(mapping.studentName ? row[mapping.studentName] : ''),
    className: mapping.className ? String(row[mapping.className] ?? '').trim() || null : null,
    faculty: mapping.faculty ? String(row[mapping.faculty] ?? '').trim() || null : null,
    participationStatus: normalizeParticipationStatus(
      mapping.participationStatus ? row[mapping.participationStatus] : undefined,
    ),
    convertedValue,
  };
}

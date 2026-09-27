type EvidenceDateCard = {
  extractedFieldsJson?: unknown;
  normalizedFieldsJson?: unknown;
  confirmedFieldsJson?: unknown;
};

export function isEvidenceDateOutsideSchoolYear(
  evidence: { evidenceCard?: EvidenceDateCard | null },
  schoolYear: string,
): boolean {
  const [startYear, endYear] = schoolYear.split('-').map(Number);
  if (!Number.isInteger(startYear) || endYear !== startYear + 1) return false;

  const card = evidence.evidenceCard;
  if (!card) return false;
  const fields = {
    ...asRecord(card.extractedFieldsJson),
    ...asRecord(card.normalizedFieldsJson),
    ...asRecord(card.confirmedFieldsJson),
  };
  const date = parseDate(
    fields.activity_date ?? fields.activityDate ?? fields.issue_date ?? fields.issueDate,
  );
  if (!date) return false;

  const start = Date.UTC(startYear, 8, 1);
  const end = Date.UTC(endYear, 7, 31);
  const value = Date.UTC(date.year, date.month - 1, date.day);
  return value < start || value > end;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseDate(value: unknown): { year: number; month: number; day: number } | null {
  const raw =
    typeof value === 'string'
      ? value
      : value && typeof value === 'object' && 'value' in value
        ? (value as { value?: unknown }).value
        : null;
  if (typeof raw !== 'string') return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  const localized = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim());
  const parts = iso
    ? { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }
    : localized
      ? { year: Number(localized[3]), month: Number(localized[2]), day: Number(localized[1]) }
      : null;
  if (!parts || !isValidDate(parts.year, parts.month, parts.day)) return null;
  return parts;
}

function isValidDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

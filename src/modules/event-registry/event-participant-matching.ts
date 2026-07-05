export type ExactParticipantNameMatch<T> =
  | { status: 'matched'; participant: T }
  | { status: 'duplicate'; participant: null }
  | { status: 'not_found'; participant: null };

export function normalizeMatchingText(value: string | null | undefined): string {
  const normalized = (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripTrailingClassCode(normalized);
}

export function stripTrailingClassSuffixFromName(value: string | null | undefined): string {
  const trimmed = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  const tokens = trimmed.split(' ');
  if (tokens.length < 2) return trimmed;

  const last = tokens[tokens.length - 1] ?? '';
  const previous = tokens[tokens.length - 2] ?? '';
  if (isYearClassToken(last)) return tokens.slice(0, -1).join(' ');
  if (isShortClassTail(last) && isYearClassToken(previous)) return tokens.slice(0, -2).join(' ');
  return trimmed;
}

export function resolveExactParticipantNameMatch<T extends { studentName: string | null }>(
  participants: T[],
  studentName: string | null | undefined,
): ExactParticipantNameMatch<T> {
  const normalizedName = normalizeMatchingText(studentName);
  if (!normalizedName) return { status: 'not_found', participant: null };

  const matches = participants.filter(
    (participant) => normalizeMatchingText(participant.studentName) === normalizedName,
  );
  if (matches.length === 1) return { status: 'matched', participant: matches[0] };
  if (matches.length > 1) return { status: 'duplicate', participant: null };
  return { status: 'not_found', participant: null };
}

function stripTrailingClassCode(value: string): string {
  const tokens = value.split(' ').filter(Boolean);
  if (tokens.length < 2) return value;

  const last = tokens[tokens.length - 1] ?? '';
  const previous = tokens[tokens.length - 2] ?? '';
  if (isYearClassToken(last)) return tokens.slice(0, -1).join(' ');
  if (isShortClassTail(last) && isYearClassToken(previous)) return tokens.slice(0, -2).join(' ');
  return tokens.join(' ');
}

function isYearClassToken(value: string): boolean {
  return /^\d{2}[a-z0-9]{1,12}$/i.test(value);
}

function isShortClassTail(value: string): boolean {
  return /^[a-z][a-z0-9]{0,8}$/i.test(value);
}

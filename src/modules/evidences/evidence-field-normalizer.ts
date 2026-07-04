import type { EvidenceExtractedFields } from './evidence-field-extractor';

export function normalizeEvidenceFields(fields: EvidenceExtractedFields): EvidenceExtractedFields {
  return removeEmpty({
    ...fields,
    student_name: fields.student_name ? normalizeWhitespace(fields.student_name) : undefined,
    student_code: fields.student_code?.toUpperCase(),
    class_name: fields.class_name?.toUpperCase(),
    faculty: fields.faculty ? normalizeWhitespace(fields.faculty) : undefined,
    event_name: fields.event_name ? normalizeWhitespace(fields.event_name) : undefined,
    organizer: fields.organizer ? normalizeWhitespace(fields.organizer) : undefined,
  });
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function removeEmpty<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, nested]) => nested !== undefined && nested !== null && nested !== ''),
  ) as T;
}

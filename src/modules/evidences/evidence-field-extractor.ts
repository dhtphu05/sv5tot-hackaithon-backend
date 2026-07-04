import type { SmartReaderOcrResult } from '../smartreader';

export type EvidenceExtractedFields = {
  student_name?: string;
  student_code?: string;
  class_name?: string;
  faculty?: string;
  document_type?: string;
  event_name?: string;
  organizer?: string;
  organizer_level?: string;
  issue_date?: string;
  activity_date?: string;
  award_level?: string;
  volunteer_days?: number;
  certificate_type?: string;
  language_score?: string;
  gpa?: number;
  conduct_score?: number;
};

export function extractEvidenceFields(input: {
  evidenceName: string;
  ocr: Pick<SmartReaderOcrResult, 'text' | 'lines' | 'paragraphs' | 'tables'>;
}): EvidenceExtractedFields {
  const text = buildSearchText(input.ocr);
  const normalized = normalizeText(text);
  const fields: EvidenceExtractedFields = {};

  fields.student_code = matchFirst(text, [
    /\b(?:MSSV|Mã\s*SV|Mã\s*sinh\s*viên|Số\s*thẻ\s*sinh\s*viên)\s*[:-]?\s*([A-Z0-9]{6,12})\b/i,
    /\b([0-9]{8,12})\b/,
  ]);
  fields.student_name = cleanName(
    matchFirst(text, [
      /(?:Họ\s*và\s*tên|Cấp\s*cho)\s*[:-]?\s*([A-ZÀ-Ỹ][^\n,.;]{3,80})/i,
      /(?:Sinh\s*viên)\s*[:-]?\s*([A-ZÀ-Ỹ][^\n,.;]{3,80})/i,
      fields.student_code
        ? new RegExp(`([A-ZÀ-Ỹ][^\\n,.;]{3,80})\\s+${escapeRegExp(fields.student_code)}`, 'i')
        : undefined,
    ]),
  );
  fields.class_name = matchFirst(text, [
    /(?:Lớp|Chi\s*đoàn)\s*[:-]?\s*([A-Z0-9._-]{2,20})/i,
    /\b([0-9]{2}[A-ZĐ]{1,6}[0-9]?)\b/u,
  ]);
  fields.faculty = matchFirst(text, [
    /(?:Khoa|Viện)\s*[:-]?\s*([^\n,.;]{3,80})/i,
    /(Khoa\s+[^\n,.;]{3,80})/i,
  ]);
  fields.document_type = detectDocumentType(normalized);
  fields.certificate_type = fields.document_type;
  fields.event_name = matchFirst(text, [
    /(?:về\s*việc|tham\s*gia|hoàn\s*thành|đạt\s*giải)\s+([^\n.;]{6,140})/i,
    /(?:cuộc\s*thi|chiến\s*dịch|chương\s*trình|hoạt\s*động)\s+([^\n.;]{6,140})/i,
  ]) ?? input.evidenceName;
  fields.organizer = matchFirst(text, [
    /((?:Hội\s*Sinh\s*viên|Đoàn\s*Thanh\s*niên|Đoàn\s*TNCS|Ban\s*tổ\s*chức|Trường|Khoa|CLB)[^\n.;]{0,100})/i,
  ]);
  fields.organizer_level = detectOrganizerLevel(fields.organizer);
  fields.issue_date = matchDate(text, [
    /ngày\s+([0-9]{1,2})\s+tháng\s+([0-9]{1,2})\s+năm\s+([0-9]{4})/i,
    /\b([0-9]{1,2})[/-]([0-9]{1,2})[/-]([0-9]{4})\b/,
  ]);
  fields.activity_date = matchDate(text, [
    /từ\s+ngày\s+([0-9]{1,2})\s+tháng\s+([0-9]{1,2})\s+năm\s+([0-9]{4})/i,
    /ngày\s+([0-9]{1,2})[/-]([0-9]{1,2})[/-]([0-9]{4})/i,
  ]);
  fields.award_level = matchFirst(text, [/(giải\s+(?:nhất|nhì|ba|khuyến\s*khích|A|B|C))/i]);
  fields.volunteer_days = normalized.includes('tinh nguyen')
    ? numberFromMatch(text, /([0-9]{1,3})\s*(?:ngày|buổi)\s*(?:tình\s*nguyện|tham\s*gia)/i)
    : undefined;
  fields.language_score = matchFirst(text, [
    /\b(IELTS\s*[0-9](?:\.[0-9])?)\b/i,
    /\b(TOEIC\s*[0-9]{3,4})\b/i,
    /\b(TOEFL\s*[0-9]{2,3})\b/i,
    /\b(A2|B1|B2|C1|C2)\b/i,
  ]);
  fields.gpa = numberFromMatch(text, /\b(?:GPA|điểm\s*trung\s*bình)\s*[:-]?\s*([0-9](?:\.[0-9]{1,2})?)\s*\/\s*(?:4|10)\b/i);
  fields.conduct_score = numberFromMatch(text, /\b(?:điểm\s*rèn\s*luyện|conduct)\s*[:-]?\s*([0-9]{2,3})\b/i);

  return removeEmpty(fields);
}

export function normalizeExtractedFields(fields: EvidenceExtractedFields): EvidenceExtractedFields {
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

function buildSearchText(ocr: Pick<SmartReaderOcrResult, 'text' | 'lines' | 'paragraphs' | 'tables'>): string {
  const tableText = ocr.tables
    .flatMap((table) => table.rows)
    .map((row) => (Array.isArray(row) ? row.join(' ') : JSON.stringify(row)))
    .join('\n');
  return [
    ocr.text,
    ...ocr.lines.map((line) => line.text),
    ...ocr.paragraphs.map((paragraph) => paragraph.text),
    tableText,
  ]
    .filter(Boolean)
    .join('\n');
}

function matchFirst(text: string, patterns: Array<RegExp | undefined>): string | undefined {
  for (const pattern of patterns) {
    if (!pattern) continue;
    const match = text.match(pattern);
    const value = match?.slice(1).find(Boolean) ?? match?.[0];
    if (value) return normalizeWhitespace(value);
  }
  return undefined;
}

function numberFromMatch(text: string, pattern: RegExp): number | undefined {
  const value = matchFirst(text, [pattern]);
  if (!value) return undefined;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function matchDate(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const numbers = match.slice(1, 4).map(Number);
    const normalized = normalizeVietnameseDate(numbers);
    if (normalized) return normalized;
  }
  return undefined;
}

function normalizeVietnameseDate(numbers: number[]): string | undefined {
  if (numbers.length < 3) return undefined;
  const [day, month, year] = numbers[0] > 31 ? [numbers[2], numbers[1], numbers[0]] : numbers;
  if (!day || !month || !year) return undefined;
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
    .toString()
    .padStart(2, '0')}`;
}

function detectDocumentType(normalized: string): string | undefined {
  if (normalized.includes('quyet dinh')) return 'decision';
  if (normalized.includes('giay chung nhan') || normalized.includes('chung nhan')) return 'certificate';
  if (normalized.includes('bang diem')) return 'transcript';
  if (normalized.includes('chung chi')) return 'certificate';
  return undefined;
}

function detectOrganizerLevel(organizer?: string): string | undefined {
  if (!organizer) return undefined;
  const normalized = normalizeText(organizer);
  if (normalized.includes('trung uong')) return 'central';
  if (normalized.includes('thanh pho') || normalized.includes('tp.')) return 'city';
  if (normalized.includes('dai hoc da nang')) return 'university';
  if (normalized.includes('truong') || normalized.includes('khoa') || normalized.includes('clb')) return 'school';
  return undefined;
}

function cleanName(value?: string): string | undefined {
  if (!value) return undefined;
  return normalizeWhitespace(value.replace(/\b(MSSV|Mã\s*SV|Lớp)\b.*$/i, ''));
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function removeEmpty<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, nested]) => nested !== undefined && nested !== null && nested !== ''),
  ) as T;
}

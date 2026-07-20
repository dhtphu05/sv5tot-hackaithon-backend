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
    /\b(?:MSSV|Mã\s*SV|Mã\s*sinh\s*viên|Mã\s*số\s*sinh\s*viên|Số\s*thẻ\s*sinh\s*viên)\s*[:-]?\s*([A-Z0-9]{6,12})\b/i,
    /\b(?:sinh\s*viên|student)\s+(?:có\s+)?(?:mã\s*)?([0-9]{8,12})\b/i,
  ]);
  fields.student_name = selectStudentName(text, fields.student_code);
  fields.class_name = selectClassName(text);
  fields.document_type = detectDocumentType(normalized);
  fields.certificate_type = fields.document_type;
  fields.faculty = selectFaculty(text);

  const isTranscript = fields.document_type === 'transcript';
  if (isTranscript) {
    fields.issue_date = matchDate(text, [
      /(?:Đà\s*Nẵng|Hà\s*Nội|TP\.?\s*HCM|Thành\s*phố\s*Hồ\s*Chí\s*Minh)[^\n]{0,60}ngày\s+([0-9]{1,2})\s+tháng\s+([0-9]{1,2})\s+năm\s+([0-9]{4})/i,
      /(?:ngày\s*cấp|ngày\s*ký)\s*[:-]?\s*([0-9]{1,2})[/-]([0-9]{1,2})[/-]([0-9]{4})/i,
    ]);
  } else {
    fields.event_name =
      matchFirst(text, [
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
  }
  fields.award_level = matchFirst(text, [/(giải\s+(?:nhất|nhì|ba|khuyến\s*khích|A|B|C))/i]);
  fields.volunteer_days = normalized.includes('tinh nguyen')
    ? (numberFromMatch(text, /([0-9]{1,3})\s*(?:ngày|buổi)\s*(?:tình\s*nguyện|tham\s*gia)/i) ??
      (normalized.includes('hien mau') ? 1 : undefined))
    : undefined;
  fields.language_score = matchFirst(text, [
    /\b(IELTS\s*[0-9](?:\.[0-9])?)\b/i,
    /\b(TOEIC\s*[0-9]{3,4})\b/i,
    /\b(TOEFL\s*[0-9]{2,3})\b/i,
    /\b(A2|B1|B2|C1|C2)\b/i,
  ]);
  fields.gpa =
    numberFromMatch(
      text,
      /\b(?:GPA|điểm\s*trung\s*bình)\s*[:-]?\s*([0-9](?:[.,][0-9]{1,2})?)\s*\/\s*(?:4|10)\b/i,
    ) ??
    (isTranscript
      ? numberFromMatch(
          text,
          /\b(?:điểm\s*)?(?:TBC|TBCTL|trung\s*bình\s*chung|trung\s*bình\s*tích\s*lũy)[^\n:;]{0,40}[:;]?\s*([0-4](?:[.,][0-9]{1,2})?)\b/i,
        )
      : undefined);
  fields.conduct_score = numberFromMatch(
    text,
    /(?:điểm\s*rèn\s*luyện|conduct)\s*[:-]?\s*([0-9]{2,3})\b/i,
  );

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

function buildSearchText(
  ocr: Pick<SmartReaderOcrResult, 'text' | 'lines' | 'paragraphs' | 'tables'>,
): string {
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

function selectStudentName(text: string, studentCode?: string): string | undefined {
  const candidates = [
    matchFirst(text, [
      /(?:Họ\s*và\s*tên|Cấp\s*cho)\s*[:-]?\s*([A-ZÀ-Ỹ][^\n,.;]{3,80})/i,
      /(?:Sinh\s*viên)\s*[:-]?\s*([A-ZÀ-Ỹ][^\n,.;]{3,80})/i,
    ]),
    studentCode
      ? matchFirst(text, [
          new RegExp(`([A-ZÀ-Ỹ][^\\n,.;]{3,80})\\s+${escapeRegExp(studentCode)}`, 'i'),
        ])
      : undefined,
  ];
  return candidates
    .map(cleanName)
    .find((candidate) => candidate && isPlausibleStudentName(candidate));
}

function selectFaculty(text: string): string | undefined {
  const explicit = matchFirst(text, [
    /(?:Khoa|Viện|Đơn\s*vị)[ \t]*:[ \t]*([^\n,.;]{3,80})/i,
    /(?:Khoa|Viện|Đơn\s*vị)[ \t]+([A-ZÀ-Ỹ][^\n,.;]{3,80})/i,
    /(?:Ngành|Chuyên\s*ngành)[ \t]*:[ \t]*([^\n,.;]{3,80})/i,
  ]);
  if (!explicit) return undefined;
  const value = normalizeWhitespace(explicit);
  if (/^\s*trong\b/i.test(value) || isNoisyProfileField(value)) return undefined;
  return value;
}

function selectClassName(text: string): string | undefined {
  const explicit = matchFirst(text, [/(?:Lớp|Chi\s*đoàn)\s*[:-]?\s*([A-Z0-9._-]{2,24})/i]);
  if (explicit && isClassCode(explicit)) return explicit.toUpperCase();

  const standalone = matchFirst(text, [/\b([0-9]{2}[A-ZĐ]{1,8}(?:CLC)?[0-9]?)\b/u]);
  return standalone && isClassCode(standalone) ? standalone.toUpperCase() : undefined;
}

function isPlausibleStudentName(value: string): boolean {
  const normalized = normalizeText(value);
  if (isNoisyProfileField(value)) return false;
  if (/\d/.test(value)) return false;
  if (normalized.split(/\s+/).length < 2) return false;
  return true;
}

function isNoisyProfileField(value: string): boolean {
  const normalized = normalizeText(value);
  return [
    'nganh',
    'khoa',
    'truong',
    'hoi nghi',
    'cuoc thi',
    'ky su',
    'tri tue nhan tao',
    'bim',
    'aik',
    'nghien cuu',
  ].some((keyword) => normalized.includes(keyword));
}

function isClassCode(value: string): boolean {
  return /^[0-9]{2}[A-ZĐ]{1,8}(?:[_-]?[A-ZĐ0-9]{1,8})?$/.test(value.toUpperCase());
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
  if (normalized.includes('giay khen')) return 'award';
  if (normalized.includes('giay chung nhan') || normalized.includes('chung nhan'))
    return 'certificate';
  if (normalized.includes('bang diem')) return 'transcript';
  if (/(ielts|toeic|toefl|\ba2\b|\bb1\b|\bb2\b|\bc1\b|\bc2\b)/i.test(normalized)) {
    return 'language_certificate';
  }
  if (normalized.includes('chung chi')) return 'certificate';
  return undefined;
}

function detectOrganizerLevel(organizer?: string): string | undefined {
  if (!organizer) return 'unknown';
  const normalized = normalizeText(organizer);
  if (normalized.includes('trung uong')) return 'central';
  if (normalized.includes('thanh pho') || normalized.includes('tp.')) return 'city';
  if (normalized.includes('dai hoc da nang')) return 'university';
  if (normalized.includes('truong')) return 'school';
  if (normalized.includes('khoa')) return 'faculty';
  if (normalized.includes('clb') || normalized.includes('cau lac bo')) return 'club';
  return 'external';
}

function cleanName(value?: string): string | undefined {
  if (!value) return undefined;
  return normalizeWhitespace(value.replace(/\b(MSSV|Mã\s*SV|Lớp)\b.*$/i, ''));
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/đ/g, 'd')
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
    Object.entries(value).filter(
      ([, nested]) => nested !== undefined && nested !== null && nested !== '',
    ),
  ) as T;
}

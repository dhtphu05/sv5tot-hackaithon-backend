import type { SmartReaderOcrResult, SmartReaderParagraph, SmartReaderTable, SmartReaderTextLine } from '../smartreader';

export type NormalizedEvidenceOcr = {
  ocrText: string;
  ocrLinesJson: SmartReaderTextLine[];
  ocrParagraphsJson: SmartReaderParagraph[];
  ocrTablesJson: SmartReaderTable[];
  warnings: string[];
  warningMessages: string[];
  numOfPages?: number;
  sourceEndpoint: string;
};

export function normalizeEvidenceOcr(
  ocr: SmartReaderOcrResult,
  sourceEndpoint: string,
): NormalizedEvidenceOcr {
  const rawObject = asRecord(asRecord(ocr.raw).object ?? ocr.raw);
  const phrases = arrayOfRecords(rawObject.phrases ?? rawObject.Phrase ?? rawObject.phrase);
  const phraseLines = phrases.flatMap((phrase) => phraseToLines(phrase));
  const phraseParagraphs = phrases.flatMap((phrase) => phraseToParagraphs(phrase));
  const phraseTables = phrases.flatMap((phrase) => phraseToTables(phrase));
  const lines = ocr.lines.length ? ocr.lines : phraseLines;
  const paragraphs = ocr.paragraphs.length ? ocr.paragraphs : phraseParagraphs;
  const tables = ocr.tables.length ? ocr.tables : phraseTables;
  const text = ocr.text || collectText([lines, paragraphs, tables]);

  return {
    ocrText: text,
    ocrLinesJson: lines,
    ocrParagraphsJson: paragraphs,
    ocrTablesJson: tables,
    warnings: [...ocr.warnings, ...normalizeArray(rawObject.warnings ?? rawObject.warning)],
    warningMessages: [
      ...ocr.warningMessages,
      ...normalizeArray(rawObject.warning_messages ?? rawObject.warningMessages),
    ],
    numOfPages: ocr.numOfPages ?? numberValue(rawObject.num_of_pages) ?? numberValue(rawObject.total_page_num),
    sourceEndpoint,
  };
}

function phraseToLines(phrase: Record<string, unknown>): SmartReaderTextLine[] {
  const cells = arrayOfRecords(phrase.cells ?? phrase.Cell);
  const source = cells.length ? cells : [phrase];
  return source
    .map((item) => ({
      text: stringValue(item.text ?? item.value ?? item.content) ?? '',
      confidence: numberValue(item.confidence_score ?? item.confidence ?? item.conf),
      page: numberValue(item.page_id ?? item.page ?? item.page_num),
      bbox: item.bboxes ?? item.bbox ?? item.box,
    }))
    .filter((line) => line.text);
}

function phraseToParagraphs(phrase: Record<string, unknown>): SmartReaderParagraph[] {
  const text = stringValue(phrase.text);
  if (!text) return [];
  return [{
    text,
    confidence: numberValue(phrase.confidence_score ?? phrase.confidence),
    page: numberValue(phrase.page_id ?? phrase.page ?? phrase.page_num),
  }];
}

function phraseToTables(phrase: Record<string, unknown>): SmartReaderTable[] {
  const type = stringValue(phrase.type)?.toLowerCase();
  const cells = arrayOfRecords(phrase.cells ?? phrase.Cell);
  if (!cells.length || (type !== 'table' && type !== 'list')) return [];
  return [{
    rows: cells,
    confidence: numberValue(phrase.confidence_score ?? phrase.confidence),
    page: numberValue(phrase.page_id ?? phrase.page ?? phrase.page_num),
  }];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    : [];
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function normalizeArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => stringValue(item)).filter((item): item is string => !!item);
  }
  const single = stringValue(value);
  return single ? [single] : [];
}

function collectText(value: unknown): string {
  if (Array.isArray(value)) return value.map(collectText).filter(Boolean).join('\n');
  if (!value || typeof value !== 'object') return typeof value === 'string' ? value : '';
  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string') return record.text;
  return Object.values(record).map(collectText).filter(Boolean).join('\n');
}

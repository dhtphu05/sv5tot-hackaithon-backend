import type { SmartReaderOcrResult, SmartReaderTable } from '../smartreader';

export type NormalizedDecisionTable = {
  pageNumber?: number;
  tableIndex: number;
  header: string[];
  rows: Array<Record<string, unknown>>;
  rawRows: unknown[];
  confidence?: number;
};

export function normalizeDecisionTables(ocr: SmartReaderOcrResult): NormalizedDecisionTable[] {
  const explicitTables = ocr.tables.map((table, index) => normalizeTable(table, index)).filter((table) => table.rows.length);
  if (explicitTables.length) return explicitTables;
  return normalizeTablesFromLineCells(ocr.raw);
}

function normalizeTable(table: SmartReaderTable, tableIndex: number): NormalizedDecisionTable {
  const rawRows = Array.isArray(table.rows) ? table.rows : [];
  const matrix = rawRows.map(rowToCells).filter((row) => row.some(Boolean));
  const header = inferHeader(matrix);
  const dataRows = matrix.slice(header.sourceRow + 1);
  const rows = dataRows.map((cells, sourceIndex) => {
    const record: Record<string, unknown> = {
      __sourceRowIndex: header.sourceRow + sourceIndex + 1,
    };
    header.columns.forEach((column, index) => {
      record[column || `column_${index + 1}`] = cells[index] ?? '';
    });
    return record;
  });

  return {
    pageNumber: table.page,
    tableIndex,
    header: header.columns,
    rows,
    rawRows,
    confidence: table.confidence,
  };
}

function rowToCells(row: unknown): string[] {
  if (Array.isArray(row)) return row.map(cellToText);
  if (!row || typeof row !== 'object') return [cellToText(row)];

  const record = row as Record<string, unknown>;
  if (Array.isArray(record.cells)) return record.cells.map(cellToText);
  if (Array.isArray(record.columns)) return record.columns.map(cellToText);
  if (Array.isArray(record.values)) return record.values.map(cellToText);
  return Object.values(record).map(cellToText);
}

function cellToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return cellToText(record.text ?? record.value ?? record.content ?? record.raw);
  }
  return '';
}

function inferHeader(matrix: string[][]): { columns: string[]; sourceRow: number } {
  if (!matrix.length) return { columns: [], sourceRow: -1 };
  const scored = matrix.slice(0, Math.min(matrix.length, 5)).map((row, index) => ({
    index,
    row,
    score: row.reduce((sum, cell) => sum + headerScore(cell), 0),
  }));
  const best = scored.sort((a, b) => b.score - a.score)[0];
  const source = best?.score ? best : { index: 0, row: matrix[0] };
  return {
    columns: source.row.map((cell, index) => cell || `column_${index + 1}`),
    sourceRow: source.index,
  };
}

function headerScore(value: string): number {
  const text = normalizeText(value);
  if (!text) return 0;
  if (/(mssv|ma sinh vien|student code)/.test(text)) return 5;
  if (/(ho ten|ho va ten|student name|full name)/.test(text)) return 5;
  if (/(lop|class|khoa|faculty|don vi)/.test(text)) return 3;
  if (/(diem|ngay|so ngay|gia tri|quy doi|status|trang thai)/.test(text)) return 2;
  return 0;
}

export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeTablesFromLineCells(raw: unknown): NormalizedDecisionTable[] {
  const object = rawObject(raw);
  const cells = arrayOfRecords(object.lines)
    .flatMap((line) => arrayOfRecords(line.cells))
    .filter((cell) => textValue(cell.text));
  if (!cells.length) return [];

  const groupedByPage = new Map<number, Record<string, unknown>[]>();
  for (const cell of cells) {
    const page = numberValue(cell.page_id ?? cell.page ?? cell.pageNum) ?? firstBboxPage(cell) ?? 1;
    groupedByPage.set(page, [...(groupedByPage.get(page) ?? []), cell]);
  }

  const tables: NormalizedDecisionTable[] = [];
  for (const [pageNumber, pageCells] of [...groupedByPage.entries()].sort((a, b) => a[0] - b[0])) {
    const rowGroups = groupCellsByLine(pageCells);
    const rosterRows = rowGroups
      .map((row) => cellsToRosterRecord(row.cells, row.lineId))
      .filter((row): row is Record<string, unknown> => !!row);
    if (rosterRows.length) {
      tables.push({
        pageNumber,
        tableIndex: tables.length,
        header: ['TT', 'MSSV', 'Họ và tên', 'Lớp', 'Ghi chú'],
        rows: rosterRows,
        rawRows: rowGroups.map((row) => row.cells),
        confidence: 0.82,
      });
    }
  }
  return tables;
}

function groupCellsByLine(cells: Record<string, unknown>[]) {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const cell of cells) {
    const page = numberValue(cell.page_id ?? cell.page ?? cell.pageNum) ?? firstBboxPage(cell) ?? 1;
    const lineId = numberValue(cell.line_id ?? cell.lineId) ?? Math.round((bbox(cell)?.[1] ?? 0) * 1000);
    const key = `${page}:${lineId}`;
    groups.set(key, [...(groups.get(key) ?? []), cell]);
  }

  return [...groups.entries()]
    .map(([key, groupedCells]) => ({
      lineId: Number(key.split(':')[1] ?? 0),
      y: Math.min(...groupedCells.map((cell) => bbox(cell)?.[1] ?? 0)),
      cells: groupedCells.sort((a, b) => (bbox(a)?.[0] ?? 0) - (bbox(b)?.[0] ?? 0)),
    }))
    .sort((a, b) => a.y - b.y);
}

function cellsToRosterRecord(cells: Record<string, unknown>[], lineId: number): Record<string, unknown> | undefined {
  const lineText = cells.map((cell) => textValue(cell.text)).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const parsedLine = parseRosterLineText(lineText, lineId);
  if (parsedLine) return parsedLine;

  const buckets: Record<'tt' | 'studentCode' | 'studentName' | 'className' | 'note', string[]> = {
    tt: [],
    studentCode: [],
    studentName: [],
    className: [],
    note: [],
  };
  for (const cell of cells) {
    const text = textValue(cell.text);
    const box = bbox(cell);
    if (!text || !box) continue;
    const x = box[0];
    if (x < 0.2) buckets.tt.push(text);
    else if (x < 0.34) buckets.studentCode.push(text);
    else if (x < 0.6) buckets.studentName.push(text);
    else if (x < 0.78) buckets.className.push(text);
    else buckets.note.push(text);
  }

  const studentCode = buckets.studentCode.join(' ').replace(/\D/g, '');
  const studentName = buckets.studentName.join(' ').trim();
  const className = buckets.className.join(' ').trim();
  const tt = buckets.tt.join(' ').replace(/\D/g, '');
  if (!/^\d{7,12}$/.test(studentCode) || !studentName) return undefined;

  return {
    __sourceRowIndex: lineId,
    TT: tt,
    MSSV: studentCode,
    'Họ và tên': studentName,
    Lớp: className,
    'Ghi chú': buckets.note.join(' ').trim(),
  };
}

function parseRosterLineText(lineText: string, lineId: number): Record<string, unknown> | undefined {
  const match = /^(\d{1,3})\s+(\d{7,12})\s+(.+)$/.exec(lineText);
  if (!match) return undefined;
  const [, tt, studentCode, rest] = match;
  const parts = rest.trim().split(/\s+/);
  if (parts.length < 2) return undefined;

  let className = parts[parts.length - 1] ?? '';
  let nameParts = parts.slice(0, -1);
  const previous = parts[parts.length - 2] ?? '';
  if (/^\d{2}[A-Z]+$/i.test(previous) && /^[A-Z0-9]+$/i.test(className)) {
    className = `${previous}_${className}`;
    nameParts = parts.slice(0, -2);
  }
  const studentName = nameParts.join(' ').trim();
  if (!studentName || !className || !/^\d{7,12}$/.test(studentCode)) return undefined;

  return {
    __sourceRowIndex: lineId,
    TT: tt,
    MSSV: studentCode,
    'Họ và tên': studentName,
    Lớp: className,
    'Ghi chú': '',
  };
}

function rawObject(raw: unknown): Record<string, unknown> {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const object = record.object;
  return object && typeof object === 'object' && !Array.isArray(object)
    ? (object as Record<string, unknown>)
    : record;
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function firstBboxPage(cell: Record<string, unknown>): number | undefined {
  const boxes = cell.bboxes;
  if (!boxes || typeof boxes !== 'object' || Array.isArray(boxes)) return undefined;
  return Number(Object.keys(boxes)[0]) || undefined;
}

function bbox(cell: Record<string, unknown>): number[] | undefined {
  const boxes = cell.bboxes;
  if (!boxes || typeof boxes !== 'object' || Array.isArray(boxes)) return undefined;
  const first = Object.values(boxes)[0];
  if (!Array.isArray(first)) return undefined;
  const values = first.map((value) => numberValue(value));
  return values.every((value): value is number => value !== undefined) ? values : undefined;
}

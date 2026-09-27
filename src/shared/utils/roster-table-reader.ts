import { readSheet } from 'read-excel-file/node';

export type RosterTableCell = string | number | boolean | Date | null;

export async function readRosterTable(input: {
  buffer: Buffer;
  format: 'csv' | 'xlsx';
  preserveBlankRows?: boolean;
}): Promise<{ columns: string[]; rows: RosterTableCell[][] }> {
  const matrix: unknown[][] =
    input.format === 'xlsx'
      ? (await readSheet(input.buffer)) as unknown[][]
      : input.buffer
          .toString('utf8')
          .replace(/^\uFEFF/, '')
          .split(/\r?\n/)
          .filter((line) => line.trim())
          .map(parseCsvLine);

  const [header = [], ...sourceRows] = matrix;
  const columns = header.map((cell) => String(cell ?? '').trim());
  const rows = sourceRows.map((row) => row.map(normalizeCell));
  const parsedRows = input.preserveBlankRows
    ? rows
    : rows.filter((row) => row.some((cell) => cell !== null && String(cell).trim() !== ''));

  return { columns, rows: parsedRows };
}

function normalizeCell(cell: unknown): RosterTableCell {
  if (cell === null || cell === undefined || cell === '') return null;
  if (cell instanceof Date) return cell;
  if (typeof cell === 'string' || typeof cell === 'number' || typeof cell === 'boolean') {
    return cell;
  }
  return String(cell);
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      values.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  values.push(current.trim());
  return values;
}

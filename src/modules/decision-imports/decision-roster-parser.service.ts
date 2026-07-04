import { Criterion, DecisionImportStatus, Prisma } from '@prisma/client';
import type { SmartReaderOcrResult } from '../smartreader';
import { normalizeDecisionTables, type NormalizedDecisionTable } from './decision-ocr-table-normalizer';
import { detectDecisionTableType } from './roster-table.detector';
import { suggestRosterColumnMapping, type DecisionColumnMapping } from './roster-column-mapping.service';
import { markDuplicateRows, normalizeRosterRow, type NormalizedRosterPreviewRow } from './roster-row.normalizer';

export function normalizeSmartReaderDecisionTables(ocr: SmartReaderOcrResult) {
  return normalizeDecisionTables(ocr);
}

export function buildRosterPreview(input: {
  tables: NormalizedDecisionTable[];
  fallbackCriterion?: Criterion | null;
  fallbackConvertedValue?: number | null;
  fallbackConvertedUnit?: string | null;
}) {
  const rosterTables = input.tables.filter((table) => detectDecisionTableType(table).type === 'roster');
  const primaryTable = rosterTables[0];
  const mapping = primaryTable ? suggestRosterColumnMapping(primaryTable) : undefined;
  const rows = mapping
    ? buildPreviewRowsFromTables({
        tables: rosterTables,
        mapping,
        fallbackCriterion: input.fallbackCriterion,
        fallbackConvertedValue: input.fallbackConvertedValue,
        fallbackConvertedUnit: input.fallbackConvertedUnit,
      })
    : [];
  return { rosterTables, mapping, rows };
}

export function buildPreviewRowsFromTables(input: {
  tables: NormalizedDecisionTable[];
  mapping: DecisionColumnMapping;
  fallbackCriterion?: Criterion | null;
  fallbackConvertedValue?: number | null;
  fallbackConvertedUnit?: string | null;
}): NormalizedRosterPreviewRow[] {
  const rows = input.tables.flatMap((table) =>
    table.rows.map((row) =>
      normalizeRosterRow({
        row,
        mapping: input.mapping,
        fallbackCriterion: input.fallbackCriterion,
        fallbackConvertedValue: input.fallbackConvertedValue,
        fallbackConvertedUnit: input.fallbackConvertedUnit,
        sourcePage: table.pageNumber,
        sourceTableIndex: table.tableIndex,
      }),
    ),
  );
  return markDuplicateRows(rows);
}

export async function persistDecisionRosterExtraction(input: {
  tx: Prisma.TransactionClient;
  decisionImportId: string;
  tables: NormalizedDecisionTable[];
  previewRows: NormalizedRosterPreviewRow[];
  mapping?: DecisionColumnMapping;
}) {
  await input.tx.decisionTable.deleteMany({ where: { decisionImportId: input.decisionImportId } });
  await input.tx.decisionRosterPreviewRow.deleteMany({ where: { decisionImportId: input.decisionImportId } });
  for (const table of input.tables) {
    const detected = detectDecisionTableType(table);
    await input.tx.decisionTable.create({
      data: {
        decisionImportId: input.decisionImportId,
        pageNumber: table.pageNumber,
        tableIndex: table.tableIndex,
        detectedType: detected.type,
        headerJson: table.header,
        rowsCount: table.rows.length,
        confidence: table.confidence ?? detected.confidence,
        rawTableJson: table as unknown as Prisma.InputJsonValue,
      },
    });
  }
  await input.tx.decisionRosterPreviewRow.createMany({
    data: input.previewRows.map((row) => ({
      decisionImportId: input.decisionImportId,
      studentCode: row.studentCode,
      studentName: row.studentName,
      className: row.className,
      faculty: row.faculty,
      criterion: row.criterion,
      convertedValue: row.convertedValue,
      convertedUnit: row.convertedUnit,
      participationStatus: row.participationStatus,
      sourcePage: row.sourcePage,
      sourceTableIndex: row.sourceTableIndex,
      sourceRowIndex: row.sourceRowIndex,
      validationStatus: row.validationStatus,
      validationWarningsJson: row.validationWarnings as Prisma.InputJsonValue,
      rawRowJson: row.rawRow as Prisma.InputJsonValue,
    })),
  });
  await input.tx.decisionImport.update({
    where: { id: input.decisionImportId },
    data: {
      status: DecisionImportStatus.preview_ready,
      processingStep: 'preview_ready',
      columnMappingJson: input.mapping as Prisma.InputJsonValue | undefined,
    },
  });
}

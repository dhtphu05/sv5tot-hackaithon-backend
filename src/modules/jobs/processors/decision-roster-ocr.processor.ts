import { DecisionImportStatus, type IndexingJob, type Prisma } from '@prisma/client';
import { z } from 'zod';
import { env } from '../../../config/env';
import { prisma } from '../../../infrastructure/database/prisma';
import { auditActions } from '../../../shared/constants/application';
import { AppError } from '../../../shared/errors/app-error';
import { ErrorCodes } from '../../../shared/errors/error-codes';
import { AuditService } from '../../audit/audit.service';
import { extractStructuredDocument } from '../../ai/openai-document-extraction';
import { buildRosterPreview, persistDecisionRosterExtraction } from '../../decision-imports/decision-roster-parser.service';
import { assertDecisionJobIsCurrent } from '../../decision-imports/decision-job-guard';
import { buildDecisionDocumentContent } from '../../decision-imports/decision-source-file';
import type { NormalizedDecisionTable } from '../../decision-imports/decision-ocr-table-normalizer';
import { StorageService } from '../../storage/storage.service';

const auditService = new AuditService();
const storageService = new StorageService();

const decisionRosterOutputSchema = z.object({
  tables: z.array(z.object({
    header: z.array(z.string().trim().min(1)).min(1),
    rows: z.array(z.array(z.string().nullable())),
  }).strict()),
}).strict();

const decisionRosterJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['tables'],
  properties: {
    tables: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['header', 'rows'],
        properties: {
          header: { type: 'array', items: { type: 'string' } },
          rows: {
            type: 'array',
            items: {
              type: 'array',
              items: { type: ['string', 'null'] },
            },
          },
        },
      },
    },
  },
};

export async function processDecisionRosterOcrJob(job: IndexingJob): Promise<Prisma.InputJsonObject> {
  const decisionImport = await prisma.decisionImport.findUnique({
    where: { id: job.targetId },
    include: { sourceFile: true, creator: true },
  });
  if (!decisionImport) throw new AppError(404, ErrorCodes.NOT_FOUND, 'Decision import not found for roster job');
  if (!decisionImport.sourceFile || !decisionImport.sourceFileId) {
    throw new AppError(400, ErrorCodes.EVIDENCE_FILE_REQUIRED, 'Decision import has no source file');
  }
  if (decisionImport.workspaceId !== job.workspaceId) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, 'Decision import not found for roster job');
  }

  const content = await buildDecisionDocumentContent(decisionImport.sourceFile, decisionImport.workspaceId, storageService);
  const result = await extractStructuredDocument({
    useCase: 'decision_roster',
    model: env.OPENAI_DECISION_MODEL,
    promptVersion: env.OPENAI_DECISION_PROMPT_VERSION,
    instructions: [
      'Transcribe the visible roster tables from this decision document.',
      'Return each table with its visible header and rows in source order.',
      'Preserve student codes exactly as printed, including leading zeros. Return blank cells as null.',
      'Do not infer missing values, determine eligibility, or confirm roster rows.',
    ].join('\n'),
    schemaName: 'decision_roster_tables',
    outputSchema: decisionRosterJsonSchema,
    validate: (value) => {
      const parsed = decisionRosterOutputSchema.parse(value);
      if (parsed.tables.some((table) => table.rows.some((row) => row.length !== table.header.length))) {
        throw new Error('Roster row width does not match table header');
      }
      return parsed;
    },
    content,
    timeoutMs: env.OPENAI_DOCUMENT_EXTRACTION_TIMEOUT_MS,
    maxRetries: env.OPENAI_DOCUMENT_EXTRACTION_MAX_RETRIES,
    entity: { type: 'decision_import', id: decisionImport.id },
    maxOutputTokens: 12000,
  });

  const tables = toNormalizedTables(result.data.tables);
  if (!tables.length) {
    throw new AppError(422, ErrorCodes.OCR_NO_TABLE_FOUND, 'OpenAI did not detect a roster table');
  }
  const preview = buildRosterPreview({
    tables,
    fallbackCriterion: decisionImport.criterion,
    fallbackConvertedValue: decisionImport.convertedValue,
    fallbackConvertedUnit: decisionImport.convertedUnit,
  });
  if (!preview.rosterTables.length || !preview.rows.length) {
    throw new AppError(422, ErrorCodes.ROSTER_PARSE_FAILED, 'No roster rows could be parsed from document tables');
  }

  await prisma.$transaction(async (tx) => {
    await assertDecisionJobIsCurrent(tx, job, decisionImport.sourceFileId!, 'rosterJobId');
    await persistDecisionRosterExtraction({
      tx,
      decisionImportId: decisionImport.id,
      tables,
      previewRows: preview.rows,
      mapping: preview.mapping,
    });
    await auditService.log({
      tx,
      actorId: decisionImport.createdBy,
      actorRole: decisionImport.creator.role,
      action: auditActions.DECISION_ROSTER_PARSED,
      entityType: 'decision_import',
      entityId: decisionImport.id,
      decisionImportId: decisionImport.id,
      metadata: {
        tableCount: tables.length,
        rosterTableCount: preview.rosterTables.length,
        previewRowCount: preview.rows.length,
        mapping: preview.mapping,
        telemetry: safeTelemetry(result.telemetry),
      },
    });
  });

  return {
    decisionImportId: decisionImport.id,
    tableCount: tables.length,
    rosterTableCount: preview.rosterTables.length,
    previewRowCount: preview.rows.length,
    telemetry: result.telemetry as unknown as Prisma.InputJsonObject,
  };
}

function toNormalizedTables(tables: z.infer<typeof decisionRosterOutputSchema>['tables']): NormalizedDecisionTable[] {
  return tables.map((table, tableIndex) => ({
    tableIndex,
    header: table.header,
    rows: table.rows.map((cells, sourceRowIndex) => {
      const row: Record<string, unknown> = { __sourceRowIndex: sourceRowIndex + 1 };
      table.header.forEach((column, index) => { row[column] = cells[index] ?? ''; });
      return row;
    }),
    rawRows: table.rows.map((row) => [...row]),
  }));
}

function safeTelemetry(telemetry: { model: string; requestId: string; latencyMs: number; inputTokens: number | null; outputTokens: number | null; totalTokens: number | null; attempts: number; outcome: string }) {
  return {
    provider: 'openai',
    model: telemetry.model,
    requestId: telemetry.requestId,
    latencyMs: telemetry.latencyMs,
    inputTokens: telemetry.inputTokens,
    outputTokens: telemetry.outputTokens,
    totalTokens: telemetry.totalTokens,
    attempts: telemetry.attempts,
    outcome: telemetry.outcome,
  };
}

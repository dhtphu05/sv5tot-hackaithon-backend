import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  AwardDecisionStatus,
  FileStorageType,
  JobType,
  type IndexingJob,
  type Prisma,
} from '@prisma/client';
import { z } from 'zod';
import { env } from '../../../config/env';
import { prisma } from '../../../infrastructure/database/prisma';
import { auditActions } from '../../../shared/constants/application';
import { AppError } from '../../../shared/errors/app-error';
import { ErrorCodes } from '../../../shared/errors/error-codes';
import { readRosterTable } from '../../../shared/utils/roster-table-reader';
import { createApplicationAudit } from '../../applications/application.helpers';
import { extractStructuredDocument } from '../../ai/openai-document-extraction';
import { StorageService } from '../../storage/storage.service';
import { downloadStoredObject } from '../../storage/storage-download';
import {
  buildAwardRosterPreview,
  getAwardRosterFormat,
  suggestAwardRosterMapping,
  type AwardRosterSourceCell,
  type AwardRosterSourceRow,
} from '../../award-decisions/award-roster.logic';
import { AwardRosterRepository } from '../../award-decisions/award-roster.repository';

const storageService = new StorageService();
const repository = new AwardRosterRepository();
const pdfRosterOutputSchema = z.object({
  columns: z.array(z.string().trim().min(1)).min(1),
  rows: z.array(z.array(z.string().nullable())),
}).strict().superRefine(({ columns, rows }, context) => {
  rows.forEach((row, rowIndex) => {
    if (row.length !== columns.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rows', rowIndex],
        message: 'Every extracted row must align with the extracted columns',
      });
    }
  });
});
const pdfRosterJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['columns', 'rows'],
  properties: {
    columns: { type: 'array', items: { type: 'string' } },
    rows: { type: 'array', items: { type: 'array', items: { type: ['string', 'null'] } } },
  },
};

export async function processAwardRosterIngestionJob(job: IndexingJob): Promise<Prisma.InputJsonObject> {
  if (job.jobType !== JobType.award_roster_ingestion) {
    throw new AppError(404, ErrorCodes.JOB_NOT_FOUND, 'Award roster job not found');
  }
  const decision = await prisma.awardDecision.findUnique({
    where: { id: job.targetId },
    include: { rosterFile: true },
  });
  const expectedFileId = readInputRosterFileId(job.inputJson);
  if (
    !decision ||
    !decision.rosterFile ||
    decision.status !== AwardDecisionStatus.DRAFT ||
    decision.issuerWorkspaceId !== job.workspaceId ||
    decision.rosterFileId !== expectedFileId ||
    decision.rosterFile.workspaceId !== decision.issuerWorkspaceId
  ) {
    throw new AppError(409, ErrorCodes.CONFLICT, 'Award decision or roster file changed before processing');
  }

  let format: 'csv' | 'xlsx' | 'pdf';
  try {
    format = getAwardRosterFormat(decision.rosterFile.originalName, decision.rosterFile.mimeType);
  } catch (error) {
    throw new AppError(400, ErrorCodes.FILE_TYPE_NOT_ALLOWED, error instanceof Error ? error.message : 'Roster file type is not supported');
  }
  const bytes = await readStoredFile(decision.rosterFile);
  const parsed =
    format === 'pdf'
      ? await parsePdfRoster(decision.id, bytes)
      : await readRosterTable({ buffer: bytes, format });
  const columns = parsed.columns;
  const sourceRows: AwardRosterSourceRow[] = 'sourceRows' in parsed ? parsed.sourceRows : parsed.rows;
  if (columns.length === 0) {
    throw new AppError(422, ErrorCodes.ROSTER_PARSE_FAILED, 'Roster contains no header row');
  }

  const serializableRows = sourceRows.map((row) => row.map(toJsonCell));
  const mapping = suggestAwardRosterMapping(columns);
  const context = await repository.getMappingContext(decision.issuerWorkspaceId, decision.awardLevel);
  const preview = buildAwardRosterPreview({ columns, sourceRows: serializableRows, mapping, context });
  const result = {
    rosterFileId: decision.rosterFileId,
    format,
    columns,
    sourceRows: serializableRows,
    suggestedMapping: mapping,
    mapping,
    rows: preview.rows,
    summary: preview.summary,
  };

  await createApplicationAudit(prisma, {
    actorId: decision.createdById,
    workspaceId: decision.issuerWorkspaceId,
    action: auditActions.AWARD_ROSTER_PROCESSING_COMPLETED,
    targetType: 'award_decision',
    targetId: decision.id,
    afterStateJson: { rowCount: preview.summary.total, validationSummary: preview.summary },
  });
  return result as unknown as Prisma.InputJsonObject;
}

async function parsePdfRoster(
  decisionId: string,
  bytes: Buffer,
): Promise<{ columns: string[]; sourceRows: AwardRosterSourceRow[] }> {
  const result = await extractStructuredDocument({
    useCase: 'award_roster',
    model: env.OPENAI_AWARD_ROSTER_MODEL,
    promptVersion: env.OPENAI_AWARD_ROSTER_PROMPT_VERSION,
    instructions: [
      'Extract the visible column headings and every roster row from this award roster PDF.',
      'Transcribe only visible values. Never infer, normalize, or complete a student identity.',
      'Return blank cells as null. Preserve student codes exactly as printed, including leading zeros.',
      'Each row must have exactly one cell per column. Do not decide award eligibility or confirm this roster.',
    ].join('\n'),
    schemaName: 'award_roster_table',
    outputSchema: pdfRosterJsonSchema,
    validate: (value) => pdfRosterOutputSchema.parse(value),
    content: [
      {
        type: 'input_file',
        filename: 'award-roster.pdf',
        file_data: `data:application/pdf;base64,${bytes.toString('base64')}`,
      },
    ],
    timeoutMs: env.OPENAI_DOCUMENT_EXTRACTION_TIMEOUT_MS,
    maxRetries: env.OPENAI_DOCUMENT_EXTRACTION_MAX_RETRIES,
    entity: { type: 'award_decision', id: decisionId },
    maxOutputTokens: 8000,
  });

  return {
    columns: result.data.columns,
    sourceRows: result.data.rows.map((row) => row.map((cell) => cell ?? '')),
  };
}

async function readStoredFile(file: {
  storageType: FileStorageType;
  filePath: string;
  originalName: string;
}): Promise<Buffer> {
  if (file.storageType === FileStorageType.local) {
    const root = path.resolve(env.UPLOAD_DIR);
    const filePath = path.resolve(root, file.filePath);
    const relative = path.relative(root, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new AppError(404, ErrorCodes.FILE_NOT_FOUND, 'Roster file not found');
    }
    return fs.readFile(filePath);
  }
  const signedUrl = await storageService.getSignedReadUrl(file.filePath, 300, file.storageType);
  return downloadStoredObject(signedUrl, 'Roster file download failed');
}

function readInputRosterFileId(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = (value as Record<string, unknown>).rosterFileId;
  return typeof id === 'string' ? id : null;
}

function toJsonCell(
  cell: AwardRosterSourceCell,
): Exclude<AwardRosterSourceCell, Date> {
  if (cell instanceof Date) return { __cellType: 'date', value: cell.toISOString() };
  return cell;
}

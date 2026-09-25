import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AwardDecisionStatus,
  FileStorageType,
  JobType,
  type IndexingJob,
  type Prisma,
} from '@prisma/client';
import { env } from '../../../config/env';
import { prisma } from '../../../infrastructure/database/prisma';
import { auditActions } from '../../../shared/constants/application';
import { AppError } from '../../../shared/errors/app-error';
import { ErrorCodes } from '../../../shared/errors/error-codes';
import { readRosterTable } from '../../../shared/utils/roster-table-reader';
import { createApplicationAudit } from '../../applications/application.helpers';
import { normalizeSmartReaderDecisionTables } from '../../decision-imports/decision-roster-parser.service';
import { getSmartReaderAdapter } from '../../smartreader';
import { runSmartReaderAsyncTableOcr } from '../../smartreader/smartreader-async-table-ocr';
import { StorageService } from '../../storage/storage.service';
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
      ? await parsePdfRoster(decision.rosterFile, bytes)
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
  file: { originalName: string; storageType: FileStorageType; filePath: string },
  bytes: Buffer,
): Promise<{ columns: string[]; sourceRows: AwardRosterSourceRow[] }> {
  const localPath = await prepareSmartReaderSource(file, bytes);
  try {
    const upload = await getSmartReaderAdapter().uploadFile({ filePath: localPath.filePath, originalName: file.originalName });
    const ocr = await runSmartReaderAsyncTableOcr({ fileHash: upload.hash, fileType: upload.fileType });
    const tables = normalizeSmartReaderDecisionTables(ocr);
    const columns = [...new Set(tables.flatMap((table) => table.header.filter(Boolean)))];
    if (!columns.length) throw new AppError(422, ErrorCodes.OCR_NO_TABLE_FOUND, 'PDF roster has no detected table');
    const sourceRows = tables.flatMap((table) =>
      table.rows.map((row) => columns.map((column) => toRosterCell(row[column]))),
    );
    return { columns, sourceRows };
  } finally {
    await localPath.cleanup?.();
  }
}

async function prepareSmartReaderSource(
  file: { storageType: FileStorageType; filePath: string; originalName: string },
  bytes: Buffer,
): Promise<{ filePath: string; cleanup?: () => Promise<void> }> {
  if (file.storageType === FileStorageType.local) {
    const root = path.resolve(env.UPLOAD_DIR);
    const filePath = path.resolve(root, file.filePath);
    const relative = path.relative(root, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new AppError(404, ErrorCodes.FILE_NOT_FOUND, 'Roster file not found');
    }
    return { filePath };
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), '5tot-award-roster-'));
  const filePath = path.join(directory, path.basename(file.originalName));
  await fs.writeFile(filePath, bytes);
  return { filePath, cleanup: () => fs.rm(directory, { recursive: true, force: true }) };
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
  const response = await fetch(signedUrl);
  if (!response.ok) {
    throw new AppError(502, ErrorCodes.STORAGE_ERROR, 'Roster file download failed');
  }
  return Buffer.from(await response.arrayBuffer());
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

function toRosterCell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

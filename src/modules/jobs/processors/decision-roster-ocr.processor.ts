// Owns VNPT async table OCR and roster preview persistence for Decision Import.
import {
  DecisionImportStatus,
  SmartReaderJobStatus,
  SmartReaderJobType,
  type IndexingJob,
  type Prisma,
} from '@prisma/client';
import { env } from '../../../config/env';
import { prisma } from '../../../infrastructure/database/prisma';
import { auditActions } from '../../../shared/constants/application';
import { AppError } from '../../../shared/errors/app-error';
import { ErrorCodes } from '../../../shared/errors/error-codes';
import { AuditService } from '../../audit/audit.service';
import {
  redactSmartReaderSecrets,
  type SmartReaderOcrResult,
} from '../../smartreader';
import { runSmartReaderAsyncTableOcr } from '../../smartreader/smartreader-async-table-ocr';
import {
  buildRosterPreview,
  normalizeSmartReaderDecisionTables,
  persistDecisionRosterExtraction,
} from '../../decision-imports/decision-roster-parser.service';

const auditService = new AuditService();

export async function processDecisionRosterOcrJob(job: IndexingJob): Promise<Prisma.InputJsonObject> {
  const decisionImport = await prisma.decisionImport.findUnique({
    where: { id: job.targetId },
    include: { sourceFile: true, creator: true },
  });
  if (!decisionImport) throw new AppError(404, ErrorCodes.NOT_FOUND, 'Decision import not found for roster OCR job');
  if (!decisionImport.vnptHash || !decisionImport.vnptFileType) {
    throw new AppError(400, ErrorCodes.EVIDENCE_FILE_REQUIRED, 'Decision import has no VNPT upload hash');
  }

  await prisma.decisionImport.update({
    where: { id: decisionImport.id },
    data: { status: DecisionImportStatus.ocr_processing, processingStep: 'vnpt_async_roster_ocr_started' },
  });

  const smartreaderJob = await prisma.smartReaderJob.create({
    data: {
      workspaceId: decisionImport.workspaceId,
      jobType: SmartReaderJobType.decision_roster_ocr,
      fileId: decisionImport.sourceFileId,
      decisionImportId: decisionImport.id,
      vnptHash: decisionImport.vnptHash,
      vnptFileType: decisionImport.vnptFileType,
      endpoint: 'async_scan_table',
      status: SmartReaderJobStatus.processing,
      attemptCount: 1,
      lockedAt: new Date(),
      lockedBy: 'worker:tick',
      requestPayloadJson: { indexingJobId: job.id, exporter: 'json' },
    },
  });

  try {
    await auditService.log({
      actorId: decisionImport.createdBy,
      actorRole: decisionImport.creator.role,
      action: auditActions.SMARTREADER_OCR_STARTED,
      entityType: 'smartreader_job',
      entityId: smartreaderJob.id,
      decisionImportId: decisionImport.id,
      metadata: { endpoint: 'async_scan_table', maxPolls: env.SMARTREADER_ASYNC_MAX_POLLS },
    });

    const ocr = await runAsyncRosterOcr({
      decisionImportId: decisionImport.id,
      smartreaderJobId: smartreaderJob.id,
      fileHash: decisionImport.vnptHash,
      fileType: decisionImport.vnptFileType,
    });
    const tables = normalizeSmartReaderDecisionTables(ocr);
    if (!tables.length) {
      throw new AppError(422, ErrorCodes.OCR_NO_TABLE_FOUND, 'VNPT OCR completed but no table was detected');
    }
    const preview = buildRosterPreview({
      tables,
      fallbackCriterion: decisionImport.criterion,
      fallbackConvertedValue: decisionImport.convertedValue,
      fallbackConvertedUnit: decisionImport.convertedUnit,
    });
    if (!preview.rows.length) {
      throw new AppError(422, ErrorCodes.ROSTER_PARSE_FAILED, 'No roster rows could be parsed from OCR tables');
    }

    await prisma.$transaction(async (tx) => {
      await tx.decisionImport.update({
        where: { id: decisionImport.id },
        data: { status: DecisionImportStatus.parsing_roster, processingStep: 'roster_tables_parsing' },
      });
      await persistDecisionRosterExtraction({
        tx,
        decisionImportId: decisionImport.id,
        tables,
        previewRows: preview.rows,
        mapping: preview.mapping,
      });
      await tx.smartReaderJob.update({
        where: { id: smartreaderJob.id },
        data: {
          status: SmartReaderJobStatus.completed,
          rawResponseJson: env.VNPT_SAVE_RAW_RESPONSE
            ? (redactSmartReaderSecrets(ocr.raw) as Prisma.InputJsonValue)
            : undefined,
          completedAt: new Date(),
        },
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
        },
      });
      await auditService.log({
        tx,
        actorId: decisionImport.createdBy,
        actorRole: decisionImport.creator.role,
        action: auditActions.SMARTREADER_OCR_COMPLETED,
        entityType: 'smartreader_job',
        entityId: smartreaderJob.id,
        decisionImportId: decisionImport.id,
        metadata: { tableCount: tables.length, previewRowCount: preview.rows.length },
      });
    });

    return {
      decisionImportId: decisionImport.id,
      smartreaderJobId: smartreaderJob.id,
      tableCount: tables.length,
      rosterTableCount: preview.rosterTables.length,
      previewRowCount: preview.rows.length,
    };
  } catch (error) {
    const code = error instanceof AppError ? error.code : ErrorCodes.VNPT_OCR_FAILED;
    const technicalMessage = error instanceof Error ? error.message : String(error);
    await prisma.smartReaderJob.update({
      where: { id: smartreaderJob.id },
      data: {
        status: SmartReaderJobStatus.failed,
        redactedErrorJson: redactSmartReaderSecrets({ code, message: technicalMessage }) as Prisma.InputJsonValue,
      },
    });
    await auditService.log({
      actorId: decisionImport.createdBy,
      actorRole: decisionImport.creator.role,
      action: auditActions.SMARTREADER_OCR_FAILED,
      entityType: 'smartreader_job',
      entityId: smartreaderJob.id,
      decisionImportId: decisionImport.id,
      metadata: { code, message: technicalMessage },
    });
    throw error;
  }
}

async function runAsyncRosterOcr(input: {
  decisionImportId: string;
  smartreaderJobId: string;
  fileHash: string;
  fileType: string;
}): Promise<SmartReaderOcrResult> {
  return runSmartReaderAsyncTableOcr({
    fileHash: input.fileHash,
    fileType: input.fileType,
    onStarted: async (started) => {
      await prisma.smartReaderJob.update({
        where: { id: input.smartreaderJobId },
        data: {
          status: SmartReaderJobStatus.polling,
          sessionId: started.sessionId,
          rawResponseJson: env.VNPT_SAVE_RAW_RESPONSE
            ? (redactSmartReaderSecrets(started.raw) as Prisma.InputJsonValue)
            : undefined,
        },
      });
    },
    onProgress: async (result) => {
      await prisma.smartReaderJob.update({
        where: { id: input.smartreaderJobId },
        data: {
          progressProcessedPages: result.processedPages ?? undefined,
          progressRemainingPages: result.remainingPages ?? undefined,
          resultLink: result.resultLink,
          vnptStatus: result.status,
          rawResponseJson: env.VNPT_SAVE_RAW_RESPONSE
            ? (redactSmartReaderSecrets(result.raw) as Prisma.InputJsonValue)
            : undefined,
        },
      });
    },
    onPollingSummary: async (summary) => {
      await auditService.log({
        action: auditActions.SMARTREADER_OCR_POLLING_SUMMARY,
        entityType: 'smartreader_job',
        entityId: input.smartreaderJobId,
        decisionImportId: input.decisionImportId,
        metadata: summary,
      });
    },
  });
}

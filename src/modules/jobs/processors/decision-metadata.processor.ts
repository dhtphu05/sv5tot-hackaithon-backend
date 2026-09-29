import { DecisionImportStatus, Prisma, type IndexingJob } from '@prisma/client';
import { z } from 'zod';
import { env } from '../../../config/env';
import { prisma } from '../../../infrastructure/database/prisma';
import { auditActions } from '../../../shared/constants/application';
import { AppError } from '../../../shared/errors/app-error';
import { ErrorCodes } from '../../../shared/errors/error-codes';
import { AuditService } from '../../audit/audit.service';
import { extractStructuredDocument } from '../../ai/openai-document-extraction';
import { buildDecisionDocumentContent } from '../../decision-imports/decision-source-file';
import { assertDecisionJobIsCurrent } from '../../decision-imports/decision-job-guard';
import { StorageService } from '../../storage/storage.service';

const auditService = new AuditService();
const storageService = new StorageService();

const decisionMetadataSchema = z.object({
  documentNo: z.string().nullable(),
  documentType: z.string().nullable(),
  issuer: z.string().nullable(),
  issueDate: z.string().nullable(),
  signer: z.string().nullable(),
  summary: z.string().nullable(),
}).strict();

const decisionMetadataJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['documentNo', 'documentType', 'issuer', 'issueDate', 'signer', 'summary'],
  properties: {
    documentNo: { type: ['string', 'null'] },
    documentType: { type: ['string', 'null'] },
    issuer: { type: ['string', 'null'] },
    issueDate: { type: ['string', 'null'] },
    signer: { type: ['string', 'null'] },
    summary: { type: ['string', 'null'] },
  },
};

export async function processDecisionMetadataJob(job: IndexingJob): Promise<Prisma.InputJsonObject> {
  const decisionImport = await prisma.decisionImport.findUnique({
    where: { id: job.targetId },
    include: { sourceFile: true, creator: true },
  });
  if (!decisionImport) throw new AppError(404, ErrorCodes.NOT_FOUND, 'Decision import not found for metadata job');
  if (!decisionImport.sourceFile || !decisionImport.sourceFileId) {
    throw new AppError(400, ErrorCodes.EVIDENCE_FILE_REQUIRED, 'Decision import has no source file');
  }
  if (decisionImport.workspaceId !== job.workspaceId) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, 'Decision import not found for metadata job');
  }

  const content = await buildDecisionDocumentContent(decisionImport.sourceFile, decisionImport.workspaceId, storageService);
  const result = await extractStructuredDocument({
    useCase: 'decision_metadata',
    model: env.OPENAI_DECISION_MODEL,
    promptVersion: env.OPENAI_DECISION_PROMPT_VERSION,
    instructions: [
      'Extract only visible metadata from this official decision document.',
      'Do not infer missing fields. Return null when a value is absent or unreadable.',
      'Transcribe the document number, type, issuing organization, issue date, signer, and a brief summary.',
      'Do not determine eligibility, approve the document, or make any workflow decision.',
    ].join('\n'),
    schemaName: 'decision_metadata',
    outputSchema: decisionMetadataJsonSchema,
    validate: (value) => decisionMetadataSchema.parse(value),
    content,
    timeoutMs: env.OPENAI_DOCUMENT_EXTRACTION_TIMEOUT_MS,
    maxRetries: env.OPENAI_DOCUMENT_EXTRACTION_MAX_RETRIES,
    entity: { type: 'decision_import', id: decisionImport.id },
    maxOutputTokens: 3000,
  });

  const issueDate = dateValue(result.data.issueDate);
  await prisma.$transaction(async (tx) => {
    await assertDecisionJobIsCurrent(tx, job, decisionImport.sourceFileId!, 'metadataJobId');
    await tx.decisionDocument.upsert({
      where: { decisionImportId: decisionImport.id },
      update: {
        documentNo: clean(result.data.documentNo),
        documentType: clean(result.data.documentType),
        issuer: clean(result.data.issuer),
        issueDate,
        signer: clean(result.data.signer),
        summary: clean(result.data.summary),
        rawAdminResponseJson: Prisma.DbNull,
      },
      create: {
        decisionImportId: decisionImport.id,
        documentNo: clean(result.data.documentNo),
        documentType: clean(result.data.documentType),
        issuer: clean(result.data.issuer),
        issueDate,
        signer: clean(result.data.signer),
        summary: clean(result.data.summary),
      },
    });
    await tx.decisionImport.update({
      where: { id: decisionImport.id },
      data: {
        organizer: decisionImport.organizer ?? clean(result.data.issuer),
        status: DecisionImportStatus.ocr_processing,
        processingStep: 'openai_metadata_extracted',
      },
    });
    await auditService.log({
      tx,
      actorId: decisionImport.createdBy,
      actorRole: decisionImport.creator.role,
      action: auditActions.DECISION_METADATA_EXTRACTED,
      entityType: 'decision_import',
      entityId: decisionImport.id,
      decisionImportId: decisionImport.id,
      metadata: safeTelemetry(result.telemetry),
    });
  });

  return {
    decisionImportId: decisionImport.id,
    documentNo: result.data.documentNo,
    issuer: result.data.issuer,
    issueDate: issueDate?.toISOString() ?? null,
    telemetry: result.telemetry as unknown as Prisma.InputJsonObject,
  };
}

function clean(value: string | null): string | undefined {
  const text = value?.trim();
  return text || undefined;
}

function dateValue(value: string | null): Date | undefined {
  if (!value?.trim()) return undefined;
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? undefined : date;
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

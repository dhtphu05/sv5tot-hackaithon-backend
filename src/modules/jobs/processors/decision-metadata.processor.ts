// Owns VNPT administrative-document extraction for Decision Import.
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
import { getSmartReaderAdapter, redactSmartReaderSecrets } from '../../smartreader';

const auditService = new AuditService();

export async function processDecisionMetadataJob(job: IndexingJob): Promise<Prisma.InputJsonObject> {
  const decisionImport = await prisma.decisionImport.findUnique({
    where: { id: job.targetId },
    include: { sourceFile: true, creator: true },
  });
  if (!decisionImport) throw new AppError(404, ErrorCodes.NOT_FOUND, 'Decision import not found for metadata job');
  if (!decisionImport.vnptHash || !decisionImport.vnptFileType) {
    throw new AppError(400, ErrorCodes.EVIDENCE_FILE_REQUIRED, 'Decision import has no VNPT upload hash');
  }

  await prisma.decisionImport.update({
    where: { id: decisionImport.id },
    data: { status: DecisionImportStatus.extracting_metadata, processingStep: 'vnpt_admin_doc_extracting' },
  });

  const smartreaderJob = await prisma.smartReaderJob.create({
    data: {
      workspaceId: decisionImport.workspaceId,
      jobType: SmartReaderJobType.decision_metadata,
      fileId: decisionImport.sourceFileId,
      decisionImportId: decisionImport.id,
      vnptHash: decisionImport.vnptHash,
      vnptFileType: decisionImport.vnptFileType,
      endpoint: 'admin_doc',
      status: SmartReaderJobStatus.processing,
      attemptCount: 1,
      lockedAt: new Date(),
      lockedBy: 'worker:tick',
      requestPayloadJson: { indexingJobId: job.id },
    },
  });

  try {
    const result = await getSmartReaderAdapter().extractAdministrativeDocument({
      fileHash: decisionImport.vnptHash,
      fileType: decisionImport.vnptFileType,
      details: true,
    });
    const fields = result.fields;
    const documentNo = text(fields.so_ky_hieu ?? fields.document_no ?? fields.documentNo);
    const issuer = text(fields.co_quan_ban_hanh ?? fields.issuer);
    const documentType = text(fields.loai_van_ban ?? fields.document_type ?? fields.documentType);
    const summary = text(fields.trich_yeu ?? fields.summary);
    const signer = text(fields.nguoi_ky ?? fields.signer);
    const issueDate = dateValue(fields.ngay_ban_hanh ?? fields.issue_date ?? fields.issueDate);

    await prisma.$transaction(async (tx) => {
      await tx.decisionDocument.upsert({
        where: { decisionImportId: decisionImport.id },
        update: {
          documentNo,
          documentType,
          issuer,
          issueDate,
          signer,
          summary,
          rawAdminResponseJson: env.VNPT_SAVE_RAW_RESPONSE
            ? (redactSmartReaderSecrets(result.raw) as Prisma.InputJsonValue)
            : undefined,
        },
        create: {
          decisionImportId: decisionImport.id,
          documentNo,
          documentType,
          issuer,
          issueDate,
          signer,
          summary,
          rawAdminResponseJson: env.VNPT_SAVE_RAW_RESPONSE
            ? (redactSmartReaderSecrets(result.raw) as Prisma.InputJsonValue)
            : undefined,
        },
      });
      await tx.decisionImport.update({
        where: { id: decisionImport.id },
        data: {
          organizer: decisionImport.organizer ?? issuer,
          status: DecisionImportStatus.ocr_processing,
          processingStep: 'vnpt_admin_doc_extracted',
        },
      });
      await tx.smartReaderJob.update({
        where: { id: smartreaderJob.id },
        data: {
          status: SmartReaderJobStatus.completed,
          rawResponseJson: env.VNPT_SAVE_RAW_RESPONSE
            ? (redactSmartReaderSecrets(result.raw) as Prisma.InputJsonValue)
            : undefined,
          completedAt: new Date(),
        },
      });
      await auditService.log({
        tx,
        actorId: decisionImport.createdBy,
        actorRole: decisionImport.creator.role,
        action: auditActions.SMARTREADER_ADMIN_DOC_EXTRACTED,
        entityType: 'decision_import',
        entityId: decisionImport.id,
        decisionImportId: decisionImport.id,
        metadata: { smartreaderJobId: smartreaderJob.id, documentNo, issuer, issueDate },
      });
    });

    return {
      decisionImportId: decisionImport.id,
      smartreaderJobId: smartreaderJob.id,
      documentNo: documentNo ?? null,
      issuer: issuer ?? null,
      signer: signer ?? null,
      issueDate: issueDate?.toISOString() ?? null,
    };
  } catch (error) {
    await prisma.smartReaderJob.update({
      where: { id: smartreaderJob.id },
      data: {
        status: SmartReaderJobStatus.failed,
        redactedErrorJson: redactSmartReaderSecrets({ message: error instanceof Error ? error.message : error }) as Prisma.InputJsonValue,
      },
    });
    throw new AppError(
      502,
      ErrorCodes.VNPT_ADMIN_DOC_FAILED,
      'VNPT SmartReader administrative document extraction failed',
      { technicalMessage: error instanceof Error ? error.message : String(error), retryable: true },
    );
  }
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number') return String(value);
  return undefined;
}

function dateValue(value: unknown): Date | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const normalized = raw.includes('/') ? raw.split('/').reverse().join('-') : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

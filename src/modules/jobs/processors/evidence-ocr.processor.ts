// Owns OCR job processing for evidence files.
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  EvidenceStatus,
  FileStorageType,
  IndexingStatus,
  JobStatus,
  SmartReaderJobStatus,
  SmartReaderJobType,
  type File,
  type IndexingJob,
  type Prisma,
} from '@prisma/client';
import { env } from '../../../config/env';
import { prisma } from '../../../infrastructure/database/prisma';
import { auditActions } from '../../../shared/constants/application';
import { buildMissingFields } from '../../../shared/dto/evidence-student-status';
import { AppError } from '../../../shared/errors/app-error';
import { ErrorCodes, type ErrorCode } from '../../../shared/errors/error-codes';
import { AuditService } from '../../audit/audit.service';
import {
  buildEvidenceCardFieldLayers,
  hasEventNameMismatchWithUserInput,
} from '../../evidences/evidence-card-field-presenter';
import {
  getSmartReaderAdapter,
  mapOcrResponse,
  redactSmartReaderSecrets,
  SmartReaderConfigError,
  SmartReaderError,
  type SmartReaderOcrResult,
} from '../../smartreader';
import { scoreEvidenceConfidence } from '../../evidences/evidence-confidence.scorer';
import { extractEvidenceFields } from '../../evidences/evidence-field-extractor';
import { normalizeEvidenceFields } from '../../evidences/evidence-field-normalizer';
import { normalizeEvidenceOcr } from '../../evidences/evidence-ocr-normalizer';
import { matchEvidenceRegistry } from '../../evidences/evidence-registry-matcher';
import { StorageService } from '../../storage/storage.service';

const auditService = new AuditService();
const storageService = new StorageService();

type EvidenceOcrOutput = {
  ocr: SmartReaderOcrResult;
  sourceEndpoint: string;
  smartreaderJobId: string;
};

export async function processEvidenceOcrJob(job: IndexingJob): Promise<Prisma.InputJsonObject> {
  const evidence = await prisma.evidence.findUnique({
    where: { id: job.targetId },
    include: {
      application: { include: { student: true } },
      collectiveProfile: { include: { representative: true } },
      evidenceFiles: {
        include: {
          file: true,
        },
        orderBy: { id: 'asc' },
      },
    },
  });

  if (!evidence) throw new Error('Evidence not found for OCR job');

  const primaryFile = evidence.evidenceFiles[0]?.file;
  if (!primaryFile) throw new Error('Evidence has no files for OCR');

  await prisma.evidence.update({
    where: { id: evidence.id },
    data: { indexingStatus: IndexingStatus.ocr_processing },
  });

  const actor = evidence.application?.student ?? evidence.collectiveProfile?.representative;
  const workspaceId = evidence.application?.workspaceId ?? evidence.collectiveProfile?.workspaceId;
  if (!workspaceId) {
    throw new Error('Evidence workspace not found for OCR job');
  }

  const smartreaderJob = await prisma.smartReaderJob.create({
    data: {
      workspaceId,
      jobType: SmartReaderJobType.evidence_ocr,
      fileId: primaryFile.id,
      evidenceId: evidence.id,
      status: SmartReaderJobStatus.uploading,
      endpoint: selectOcrEndpoint(primaryFile),
      requestPayloadJson: {
        indexingJobId: job.id,
        fileName: primaryFile.originalName,
        mimeType: primaryFile.mimeType,
      },
      attemptCount: 1,
      lockedAt: new Date(),
      lockedBy: 'worker:tick',
    },
  });

  try {
    const uploadedFile = await ensureSmartReaderUpload(primaryFile, evidence, smartreaderJob.id);

    await auditService.log({
      actorId: actor?.id,
      actorRole: actor?.role,
      action: auditActions.SMARTREADER_OCR_STARTED,
      entityType: 'smartreader_job',
      entityId: smartreaderJob.id,
      applicationId: evidence.applicationId,
      evidenceId: evidence.id,
      metadata: { fileId: uploadedFile.id, endpoint: selectOcrEndpoint(uploadedFile) },
    });

    const output = shouldUseAsyncOcr(uploadedFile)
      ? await runAsyncOcr(uploadedFile, smartreaderJob.id)
      : await runAdvancedOcr(uploadedFile, smartreaderJob.id);
    const normalizedOcr = normalizeEvidenceOcr(output.ocr, output.sourceEndpoint);

    if (!normalizedOcr.ocrText.trim()) {
      throw new AppError(
        422,
        ErrorCodes.OCR_EMPTY_TEXT,
        'VNPT SmartReader returned no OCR text for evidence',
      );
    }

    await prisma.evidence.update({
      where: { id: evidence.id },
      data: { indexingStatus: IndexingStatus.extracting },
    });

    const extractedFields = extractEvidenceFields({
      evidenceName: evidence.evidenceName,
      ocr: {
        text: normalizedOcr.ocrText,
        lines: normalizedOcr.ocrLinesJson,
        paragraphs: normalizedOcr.ocrParagraphsJson,
        tables: normalizedOcr.ocrTablesJson,
      },
    });
    const normalizedFields = normalizeEvidenceFields(extractedFields);

    await prisma.evidence.update({
      where: { id: evidence.id },
      data: { indexingStatus: IndexingStatus.checking_registry },
    });

    const matched = await matchEvidenceRegistry(evidence.criterion, normalizedFields, workspaceId);
    const semanticWarningCodes = [
      ...(hasEventNameMismatchWithUserInput({
        evidenceName: evidence.evidenceName,
        extractedEventName: normalizedFields.event_name,
      })
        ? ['event_name_mismatch_with_user_input']
        : []),
      ...buildProfileConflictWarnings({
        profile: evidence.application?.student,
        fields: normalizedFields,
      }),
      ...(isOcrTextLowQuality(normalizedOcr.ocrText) ? ['ocr_text_low_quality'] : []),
    ];
    const scoring = scoreEvidenceConfidence({
      ocrSucceeded: true,
      fields: normalizedFields,
      evidenceName: evidence.evidenceName,
      matchedEventId: matched.eventId,
      warnings: [
        ...normalizedOcr.warnings,
        ...normalizedOcr.warningMessages,
        ...matched.warnings,
        ...semanticWarningCodes,
      ],
    });
    const warningEntries = buildWarnings(
      [...scoring.warningCodes, ...matched.warnings, ...semanticWarningCodes],
      {
        warnings: normalizedOcr.warnings,
        warningMessages: normalizedOcr.warningMessages,
      },
    );
    const fieldLayers = buildEvidenceCardFieldLayers({
      evidenceName: evidence.evidenceName,
      sourceType: evidence.sourceType,
      criterion: evidence.criterion,
      extractedFields,
      normalizedFields,
      matchedEventId: matched.eventId,
      matchedParticipantId: matched.participantId,
      warnings: warningEntries,
      studentProfileFields: {
        studentName: evidence.application?.student.fullName,
        studentCode: evidence.application?.student.studentCode,
        className: evidence.application?.student.className,
        faculty: evidence.application?.student.faculty,
      },
    });
    const lowConfidenceFieldCount = Object.values(fieldLayers.fieldConfidence).filter(
      (confidence) => confidence < 0.6,
    ).length;
    const missingFields = buildMissingFields(evidence.criterion, normalizedFields, warningEntries);
    const matchingStatusCode =
      matched.eventId && matched.participantId
        ? 'official_match_found'
        : matched.eventId
          ? 'official_match_not_found'
          : 'none';
    const nextIndexingStatus = scoring.needsManualReview
      ? IndexingStatus.needs_manual_review
      : IndexingStatus.indexed;
    const nextEvidenceStatus = scoring.needsManualReview
      ? EvidenceStatus.needs_supplement
      : EvidenceStatus.indexed;
    const rawResponseJson = env.VNPT_SAVE_RAW_RESPONSE
      ? (redactSmartReaderSecrets(output.ocr.raw) as Prisma.InputJsonValue)
      : undefined;

    await prisma.$transaction(async (tx) => {
      await tx.evidenceCard.upsert({
        where: { evidenceId: evidence.id },
        update: {
          ocrText: normalizedOcr.ocrText,
          ocrLinesJson: normalizedOcr.ocrLinesJson as Prisma.InputJsonValue,
          ocrParagraphsJson: normalizedOcr.ocrParagraphsJson as Prisma.InputJsonValue,
          ocrTablesJson: normalizedOcr.ocrTablesJson as Prisma.InputJsonValue,
          extractedFieldsJson: extractedFields as Prisma.InputJsonValue,
          normalizedFieldsJson: normalizedFields as Prisma.InputJsonValue,
          warningsJson: warningEntries as Prisma.InputJsonValue,
          matchedEventId: matched.eventId,
          matchedParticipantId: matched.participantId,
          matchedKnowledgeItemIds: [],
          confidence: scoring.confidence,
          sourceEndpoint: normalizedOcr.sourceEndpoint,
          smartreaderJobId: output.smartreaderJobId,
          aiSummary: buildEvidenceSummary(evidence.evidenceName, normalizedFields),
          rawAiResponse: undefined,
          rawResponseJson,
        },
        create: {
          evidenceId: evidence.id,
          ocrText: normalizedOcr.ocrText,
          ocrLinesJson: normalizedOcr.ocrLinesJson as Prisma.InputJsonValue,
          ocrParagraphsJson: normalizedOcr.ocrParagraphsJson as Prisma.InputJsonValue,
          ocrTablesJson: normalizedOcr.ocrTablesJson as Prisma.InputJsonValue,
          extractedFieldsJson: extractedFields as Prisma.InputJsonValue,
          normalizedFieldsJson: normalizedFields as Prisma.InputJsonValue,
          warningsJson: warningEntries as Prisma.InputJsonValue,
          matchedEventId: matched.eventId,
          matchedParticipantId: matched.participantId,
          matchedKnowledgeItemIds: [],
          confidence: scoring.confidence,
          sourceEndpoint: normalizedOcr.sourceEndpoint,
          smartreaderJobId: output.smartreaderJobId,
          aiSummary: buildEvidenceSummary(evidence.evidenceName, normalizedFields),
          rawAiResponse: undefined,
          rawResponseJson,
        },
      });

      await tx.evidence.update({
        where: { id: evidence.id },
        data: {
          indexingStatus: nextIndexingStatus,
          status: nextEvidenceStatus,
          confidence: scoring.confidence,
          eventId: matched.eventId ?? evidence.eventId,
        },
      });
    });

    await auditService.log({
      actorId: actor?.id,
      actorRole: actor?.role,
      action: auditActions.SMARTREADER_OCR_COMPLETED,
      entityType: 'smartreader_job',
      entityId: output.smartreaderJobId,
      applicationId: evidence.applicationId,
      evidenceId: evidence.id,
      metadata: {
        provider: 'vnpt_smartreader',
        fileId: primaryFile.id,
        criterion: evidence.criterion,
        sourceType: evidence.sourceType,
        numOfPages: normalizedOcr.numOfPages,
        lineCount: normalizedOcr.ocrLinesJson.length,
        paragraphCount: normalizedOcr.ocrParagraphsJson.length,
        tableCount: normalizedOcr.ocrTablesJson.length,
      },
    });
    await auditService.log({
      actorId: actor?.id,
      actorRole: actor?.role,
      action: auditActions.EVIDENCE_CARD_GENERATED,
      entityType: 'evidence',
      entityId: evidence.id,
      applicationId: evidence.applicationId,
      evidenceId: evidence.id,
      metadata: {
        provider: 'vnpt_smartreader',
        fileId: primaryFile.id,
        criterion: evidence.criterion,
        sourceType: evidence.sourceType,
        indexingStatus: nextIndexingStatus,
        statusCode: missingFields.length > 0 ? 'needs_more_info' : 'evidence_read',
        studentStatusCode: missingFields.length > 0 ? 'needs_more_info' : 'evidence_read',
        matchingStatusCode,
        missingFieldCount: missingFields.length,
        warningCount: warningEntries.length,
        lowConfidenceFieldCount,
        fieldConfidenceKeys: Object.keys(fieldLayers.fieldConfidence),
        matchedEventId: matched.eventId,
        matchedParticipantId: matched.participantId,
      },
    });
    await auditService.log({
      actorId: actor?.id,
      actorRole: actor?.role,
      action: auditActions.SMARTREADER_EVIDENCE_READ,
      entityType: 'evidence',
      entityId: evidence.id,
      applicationId: evidence.applicationId,
      evidenceId: evidence.id,
      metadata: {
        provider: 'vnpt_smartreader',
        fileId: primaryFile.id,
        criterion: evidence.criterion,
        sourceType: evidence.sourceType,
        statusCode: missingFields.length > 0 ? 'needs_more_info' : 'evidence_read',
        studentStatusCode: missingFields.length > 0 ? 'needs_more_info' : 'evidence_read',
        matchingStatusCode,
        missingFieldCount: missingFields.length,
        warningCount: warningEntries.length,
        matchedEventId: matched.eventId,
        matchedParticipantId: matched.participantId,
      },
    });
    await auditService.log({
      actorId: actor?.id,
      actorRole: actor?.role,
      action:
        matched.eventId && matched.participantId
          ? auditActions.OFFICIAL_MATCH_FOUND
          : auditActions.OFFICIAL_MATCH_NOT_FOUND,
      entityType: 'evidence',
      entityId: evidence.id,
      applicationId: evidence.applicationId,
      evidenceId: evidence.id,
      eventId: matched.eventId,
      metadata: {
        provider: 'vnpt_smartreader',
        fileId: primaryFile.id,
        criterion: evidence.criterion,
        sourceType: evidence.sourceType,
        studentStatusCode:
          matched.eventId && matched.participantId
            ? 'official_match_found'
            : 'official_match_not_found',
        matchingStatusCode,
        missingFieldCount: missingFields.length,
        warningCount: warningEntries.length,
        matchedEventId: matched.eventId,
        matchedParticipantId: matched.participantId,
      },
    });
    if (missingFields.length > 0) {
      await auditService.log({
        actorId: actor?.id,
        actorRole: actor?.role,
        action: auditActions.EVIDENCE_MISSING_INFO_DETECTED,
        entityType: 'evidence',
        entityId: evidence.id,
        applicationId: evidence.applicationId,
        evidenceId: evidence.id,
        metadata: {
          provider: 'vnpt_smartreader',
          fileId: primaryFile.id,
          criterion: evidence.criterion,
          sourceType: evidence.sourceType,
          statusCode: 'needs_more_info',
          studentStatusCode: 'needs_more_info',
          matchingStatusCode,
          missingFieldCount: missingFields.length,
          warningCount: warningEntries.length,
          matchedEventId: matched.eventId,
          matchedParticipantId: matched.participantId,
        },
      });
    }
    if (scoring.needsManualReview) {
      await auditService.log({
        actorId: actor?.id,
        actorRole: actor?.role,
        action: auditActions.EVIDENCE_NEEDS_MANUAL_REVIEW,
        entityType: 'evidence',
        entityId: evidence.id,
        applicationId: evidence.applicationId,
        evidenceId: evidence.id,
        metadata: {
          provider: 'vnpt_smartreader',
          criterion: evidence.criterion,
          sourceType: evidence.sourceType,
          confidence: scoring.confidence,
          missingFieldCount: missingFields.length,
          warningCount: warningEntries.length,
          lowConfidenceFieldCount,
          fieldConfidenceKeys: Object.keys(fieldLayers.fieldConfidence),
        },
      });
      await auditService.log({
        actorId: actor?.id,
        actorRole: actor?.role,
        action: auditActions.EVIDENCE_SENT_TO_HUMAN_VERIFICATION,
        entityType: 'evidence',
        entityId: evidence.id,
        applicationId: evidence.applicationId,
        evidenceId: evidence.id,
        metadata: {
          provider: 'vnpt_smartreader',
          fileId: primaryFile.id,
          criterion: evidence.criterion,
          sourceType: evidence.sourceType,
          statusCode: 'needs_human_verification',
          studentStatusCode: 'needs_human_verification',
          matchingStatusCode,
          missingFieldCount: missingFields.length,
          warningCount: warningEntries.length,
          matchedEventId: matched.eventId,
          matchedParticipantId: matched.participantId,
        },
      });
    }

    return {
      evidenceId: evidence.id,
      confidence: scoring.confidence,
      indexingStatus: nextIndexingStatus,
      status: nextEvidenceStatus,
      smartreaderJobId: output.smartreaderJobId,
      matchedEventId: matched.eventId,
      matchedParticipantId: matched.participantId,
      warningCodes: scoring.warningCodes,
      jobStatus: JobStatus.completed,
    };
  } catch (error) {
    const failure = mapSmartReaderFailure(error);
    await prisma.smartReaderJob.update({
      where: { id: smartreaderJob.id },
      data: {
        status: SmartReaderJobStatus.failed,
        redactedErrorJson: redactSmartReaderSecrets({
          code: failure.code,
          message: failure.technicalMessage,
          retryable: failure.retryable,
        }) as Prisma.InputJsonValue,
      },
    });
    await auditService.log({
      actorId: actor?.id,
      actorRole: actor?.role,
      action: auditActions.SMARTREADER_OCR_FAILED,
      entityType: 'smartreader_job',
      entityId: smartreaderJob.id,
      applicationId: evidence.applicationId,
      evidenceId: evidence.id,
      metadata: {
        code: failure.code,
        message: failure.userMessage,
        retryable: failure.retryable,
      },
    });
    throw new AppError(502, failure.code, failure.userMessage, {
      technicalMessage: failure.technicalMessage,
      retryable: failure.retryable,
    });
  }
}

async function ensureSmartReaderUpload(
  file: File,
  evidence: { id: string; applicationId: string | null },
  smartreaderJobId: string,
): Promise<File> {
  if (file.vnptHash && file.vnptFileType) {
    await auditService.log({
      action: auditActions.SMARTREADER_FILE_REUSED,
      entityType: 'file',
      entityId: file.id,
      applicationId: evidence.applicationId,
      evidenceId: evidence.id,
      metadata: { vnptHashPresent: true, fileType: file.vnptFileType },
    });
    await prisma.smartReaderJob.update({
      where: { id: smartreaderJobId },
      data: {
        status: SmartReaderJobStatus.processing,
        vnptHash: file.vnptHash,
        vnptFileType: file.vnptFileType,
      },
    });
    return file;
  }

  await auditService.log({
    action: auditActions.SMARTREADER_FILE_UPLOAD_STARTED,
    entityType: 'file',
    entityId: file.id,
    applicationId: evidence.applicationId,
    evidenceId: evidence.id,
    metadata: { mimeType: file.mimeType, size: file.fileSize },
  });

  const adapter = getSmartReaderAdapter();
  const uploadSource = await prepareSmartReaderUploadSource(file);
  let uploaded;
  try {
    uploaded = await adapter.uploadFile({
      filePath: uploadSource.filePath,
      originalName: file.originalName,
      title: file.originalName,
      description: `5TOT evidence OCR ${evidence.id}`,
    });
  } finally {
    await uploadSource.cleanup?.();
  }

  await auditService.log({
    action: auditActions.SMARTREADER_FILE_UPLOADED,
    entityType: 'file',
    entityId: file.id,
    applicationId: evidence.applicationId,
    evidenceId: evidence.id,
    metadata: { vnptHashPresent: !!uploaded.hash, fileType: uploaded.fileType },
  });

  return prisma.file
    .update({
      where: { id: file.id },
      data: {
        vnptHash: uploaded.hash,
        vnptFileType: uploaded.fileType,
        vnptUploadedAt: new Date(),
        vnptUploadRawJson: env.VNPT_SAVE_RAW_RESPONSE
          ? (redactSmartReaderSecrets(uploaded.raw) as Prisma.InputJsonValue)
          : undefined,
      },
    })
    .then(async (updated) => {
      await prisma.smartReaderJob.update({
        where: { id: smartreaderJobId },
        data: {
          status: SmartReaderJobStatus.processing,
          vnptHash: updated.vnptHash,
          vnptFileType: updated.vnptFileType,
        },
      });
      return updated;
    });
}

async function prepareSmartReaderUploadSource(file: File): Promise<{
  filePath: string;
  cleanup?: () => Promise<void>;
}> {
  if (file.storageType === FileStorageType.local) {
    return { filePath: path.resolve(env.UPLOAD_DIR, file.filePath) };
  }

  const signedUrl = await storageService.getSignedReadUrl(file.filePath, 300, file.storageType);
  const response = await fetch(signedUrl);
  if (!response.ok) {
    throw new Error(`VNPT upload source download failed with HTTP ${response.status}`);
  }

  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), '5tot-smartreader-'));
  const tempPath = path.join(
    tempDirectory,
    path.basename(file.originalName || file.filePath || file.id),
  );
  await fs.writeFile(tempPath, Buffer.from(await response.arrayBuffer()));

  return {
    filePath: tempPath,
    cleanup: () => fs.rm(tempDirectory, { recursive: true, force: true }),
  };
}

async function runAdvancedOcr(file: File, smartreaderJobId: string): Promise<EvidenceOcrOutput> {
  const adapter = getSmartReaderAdapter();
  const ocr = await adapter.ocrAdvanced({
    fileHash: required(file.vnptHash, 'File is missing VNPT hash'),
    fileType: required(file.vnptFileType, 'File is missing VNPT file type'),
    details: true,
    exporter: 'json',
  });
  await prisma.smartReaderJob.update({
    where: { id: smartreaderJobId },
    data: {
      status: SmartReaderJobStatus.completed,
      rawResponseJson: env.VNPT_SAVE_RAW_RESPONSE
        ? (redactSmartReaderSecrets(ocr.raw) as Prisma.InputJsonValue)
        : undefined,
      completedAt: new Date(),
    },
  });
  return { ocr, sourceEndpoint: 'ocrAdvanced:scan-table', smartreaderJobId };
}

async function runAsyncOcr(file: File, smartreaderJobId: string): Promise<EvidenceOcrOutput> {
  const adapter = getSmartReaderAdapter();
  const started = await adapter.startAdvancedAsync({
    fileHash: required(file.vnptHash, 'File is missing VNPT hash'),
    fileType: required(file.vnptFileType, 'File is missing VNPT file type'),
    details: true,
    exporter: 'json',
  });
  await prisma.smartReaderJob.update({
    where: { id: smartreaderJobId },
    data: {
      status: SmartReaderJobStatus.polling,
      sessionId: started.sessionId,
      rawResponseJson: env.VNPT_SAVE_RAW_RESPONSE
        ? (redactSmartReaderSecrets(started.raw) as Prisma.InputJsonValue)
        : undefined,
    },
  });

  const pollIntervalMs = env.VNPT_ENABLED ? 5000 : 0;
  for (let pollCount = 1; pollCount <= env.SMARTREADER_ASYNC_MAX_POLLS; pollCount += 1) {
    if (pollIntervalMs > 0) await wait(pollIntervalMs);
    const result = await adapter.getAdvancedAsyncResult(started.sessionId);
    await prisma.smartReaderJob.update({
      where: { id: smartreaderJobId },
      data: {
        progressProcessedPages: result.processedPages ?? undefined,
        progressRemainingPages: result.remainingPages ?? undefined,
        resultLink: result.resultLink,
        rawResponseJson: env.VNPT_SAVE_RAW_RESPONSE
          ? (redactSmartReaderSecrets(result.raw) as Prisma.InputJsonValue)
          : undefined,
      },
    });

    if (result.status === 'completed' || result.status === 'completed_with_link') {
      const downloaded = result.resultLink
        ? await downloadResultLink(result.resultLink)
        : undefined;
      const ocr = downloaded ?? result;
      await prisma.smartReaderJob.update({
        where: { id: smartreaderJobId },
        data: {
          status: SmartReaderJobStatus.completed,
          rawResponseJson: env.VNPT_SAVE_RAW_RESPONSE
            ? (redactSmartReaderSecrets(ocr.raw) as Prisma.InputJsonValue)
            : undefined,
          completedAt: new Date(),
        },
      });
      return {
        ocr,
        sourceEndpoint: result.resultLink ? 'ocrAsync:result-link' : 'ocrAsync:result',
        smartreaderJobId,
      };
    }

    if (result.status === 'failed' || result.status === 'cancelled') {
      throw new Error(`SmartReader async OCR ended with status ${result.status}`);
    }
  }

  throw new Error(`SmartReader async OCR exceeded max polls ${env.SMARTREADER_ASYNC_MAX_POLLS}`);
}

async function downloadResultLink(resultLink: string): Promise<SmartReaderOcrResult | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(resultLink, { signal: controller.signal });
    if (!response.ok) return undefined;
    const text = await response.text();
    const raw = JSON.parse(text) as unknown;
    return mapOcrResponse(raw);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function buildWarnings(
  codes: string[],
  ocr: Pick<SmartReaderOcrResult, 'warnings' | 'warningMessages'>,
): Array<{ code: string; message: string }> {
  const providerWarnings = [...ocr.warnings, ...ocr.warningMessages].map((message) => ({
    code: providerWarningCode(message),
    message,
  }));
  return [...codes.map((code) => ({ code, message: warningMessage(code) })), ...providerWarnings];
}

function providerWarningCode(message: string): string {
  const normalized = message
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (normalized.includes('nghieng')) return 'smartreader_warning_anh_dau_vao_nghieng';
  if (normalized.includes('mat goc') || normalized.includes('matgoc')) {
    return 'smartreader_warning_anh_dau_vao_mat_goc';
  }
  return 'smartreader_warning';
}

function warningMessage(code: string): string {
  const messages: Record<string, string> = {
    OCR_FAILED: 'OCR không đọc được minh chứng.',
    MISSING_STUDENT_INFO: 'Thiếu họ tên hoặc mã số sinh viên.',
    MISSING_EVENT_NAME: 'Thiếu tên hoạt động hoặc nội dung minh chứng rõ ràng.',
    MISSING_DATE: 'Thiếu ngày cấp hoặc ngày tham gia.',
    MISSING_ORGANIZER: 'Thiếu đơn vị tổ chức hoặc xác nhận.',
    LOW_IMAGE_QUALITY: 'Ảnh/tệp có dấu hiệu mờ, nghiêng hoặc mất góc.',
    POSSIBLE_STUDENT_MISMATCH: 'Thông tin có dấu hiệu không khớp sinh viên.',
    LOW_CONFIDENCE: 'Độ tin cậy thấp, cần kiểm tra thủ công.',
    field_low_confidence: 'Một số thông tin OCR chưa chắc chắn.',
    ocr_text_low_quality:
      'Nội dung đọc được có thể chưa chính xác do chất lượng file hoặc định dạng giấy chứng nhận.',
    ocr_student_name_conflict: 'Tên sinh viên trong file chưa khớp rõ với hồ sơ.',
    ocr_class_conflict: 'Lớp trong file chưa khớp rõ với hồ sơ.',
    ocr_faculty_conflict: 'Khoa trong file chưa khớp rõ với hồ sơ.',
    event_name_mismatch_with_user_input:
      'Tên hoạt động hệ thống đọc được khác tên minh chứng đã nhập.',
    participant_name_duplicate: 'Có nhiều sinh viên trùng họ tên trong danh sách chính thức.',
    participant_name_not_matched: 'Không tìm thấy họ tên sinh viên trong danh sách chính thức.',
    participant_not_matched_registry: 'Không tìm thấy sinh viên trong danh sách chính thức.',
    not_matched_registry: 'Chưa tìm thấy hoạt động trong danh sách chính thức.',
  };
  return messages[code] ?? code;
}

function buildEvidenceSummary(
  evidenceName: string,
  fields: ReturnType<typeof normalizeEvidenceFields>,
): string {
  const subject = fields.event_name ?? evidenceName;
  return `SmartReader đã đọc các thông tin chính từ "${subject}". Cán bộ/Hội đồng vẫn là người xác nhận cuối.`;
}

function buildProfileConflictWarnings(input: {
  profile?: {
    fullName?: string | null;
    studentCode?: string | null;
    className?: string | null;
    faculty?: string | null;
  } | null;
  fields: ReturnType<typeof normalizeEvidenceFields>;
}) {
  const warnings: string[] = [];
  if (
    input.profile?.fullName &&
    input.fields.student_name &&
    !isSimilarText(input.profile.fullName, input.fields.student_name)
  ) {
    warnings.push('ocr_student_name_conflict');
  }
  if (
    input.profile?.className &&
    input.fields.class_name &&
    normalizeMatch(input.profile.className) !== normalizeMatch(input.fields.class_name)
  ) {
    warnings.push('ocr_class_conflict');
  }
  if (
    input.profile?.faculty &&
    input.fields.faculty &&
    !isSimilarText(input.profile.faculty, input.fields.faculty)
  ) {
    warnings.push('ocr_faculty_conflict');
  }
  return warnings;
}

function isOcrTextLowQuality(text: string): boolean {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 20) return false;
  const suspicious = tokens.filter((token) => {
    const normalized = normalizeMatch(token);
    if (!normalized) return false;
    return /[a-z]{12,}/.test(normalized) || /\d[a-z]{4,}|[a-z]{4,}\d/.test(normalized);
  });
  return suspicious.length / tokens.length > 0.22;
}

function isSimilarText(left: string, right: string): boolean {
  const a = normalizeMatch(left);
  const b = normalizeMatch(right);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const aTokens = new Set(a.split(' ').filter((token) => token.length > 1));
  const bTokens = new Set(b.split(' ').filter((token) => token.length > 1));
  const overlap = [...aTokens].filter((token) => bTokens.has(token)).length;
  return overlap >= Math.min(aTokens.size, bTokens.size) * 0.6;
}

function normalizeMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/đ/g, 'd')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function selectOcrEndpoint(file: File): string {
  return shouldUseAsyncOcr(file) ? 'async_scan_table' : 'scan_table';
}

function isPdf(file: File): boolean {
  return file.mimeType === 'application/pdf' || file.vnptFileType?.toLowerCase() === 'pdf';
}

function shouldUseAsyncOcr(file: File): boolean {
  return isPdf(file) && file.fileSize >= 5 * 1024 * 1024;
}

function required(value: string | null | undefined, message: string): string {
  if (!value) throw new Error(message);
  return value;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SmartReaderFailure = {
  code: ErrorCode;
  userMessage: string;
  technicalMessage: string;
  retryable: boolean;
};

function mapSmartReaderFailure(error: unknown): SmartReaderFailure {
  const technicalMessage =
    error instanceof Error ? error.message : 'Unknown VNPT SmartReader failure';
  if (error instanceof AppError && error.code === ErrorCodes.OCR_EMPTY_TEXT) {
    return {
      code: ErrorCodes.OCR_EMPTY_TEXT,
      userMessage: 'File chưa đọc rõ. Bạn có thể tải lại bản rõ hơn.',
      technicalMessage,
      retryable: false,
    };
  }

  if (error instanceof SmartReaderConfigError) {
    return {
      code: ErrorCodes.VNPT_CONFIG_MISSING,
      userMessage: 'Thiếu cấu hình VNPT SmartReader cho pipeline OCR thật.',
      technicalMessage,
      retryable: false,
    };
  }

  if (error instanceof SmartReaderError && (error.statusCode === 401 || error.statusCode === 403)) {
    return {
      code: ErrorCodes.VNPT_AUTH_FAILED,
      userMessage: 'VNPT SmartReader từ chối xác thực. Vui lòng kiểm tra token/cấu hình.',
      technicalMessage,
      retryable: false,
    };
  }

  if (/timeout|abort|exceeded max polls/i.test(technicalMessage)) {
    return {
      code: ErrorCodes.VNPT_TIMEOUT,
      userMessage: 'VNPT SmartReader xử lý quá thời gian cho phép.',
      technicalMessage,
      retryable: true,
    };
  }

  if (/upload/i.test(technicalMessage)) {
    return {
      code: ErrorCodes.VNPT_UPLOAD_FAILED,
      userMessage: 'Chưa gửi được file đến dịch vụ số hoá. Vui lòng thử lại.',
      technicalMessage,
      retryable: true,
    };
  }

  return {
    code: ErrorCodes.VNPT_OCR_FAILED,
    userMessage:
      'Hệ thống chưa đọc được file này. Bạn có thể tải lại bản rõ hơn hoặc chờ cán bộ xác minh.',
    technicalMessage,
    retryable: true,
  };
}

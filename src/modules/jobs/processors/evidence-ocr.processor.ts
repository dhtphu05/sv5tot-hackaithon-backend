// Owns OCR job processing for evidence files.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  EvidenceStatus,
  EvidenceSourceType,
  FileStorageType,
  IndexingStatus,
  JobStatus,
  Role,
  Criterion,
  Prisma,
  type File,
  type IndexingJob,
} from '@prisma/client';
import { env } from '../../../config/env';
import { prisma } from '../../../infrastructure/database/prisma';
import { auditActions } from '../../../shared/constants/application';
import { buildMissingFields } from '../../../shared/dto/evidence-student-status';
import { AppError } from '../../../shared/errors/app-error';
import { ErrorCodes } from '../../../shared/errors/error-codes';
import {
  createEvidenceAnalysisProvider,
  toFieldConfidenceMap,
  toFlatExtractedFields,
  type EvidenceAnalysisProvider,
} from '../../ai/evidence-analysis';
import { AuditService } from '../../audit/audit.service';
import {
  buildEvidenceCardFieldLayers,
  hasEventNameMismatchWithUserInput,
} from '../../evidences/evidence-card-field-presenter';
import { evidenceCardConfirmationStatuses } from '../../evidences/evidence-card-confirmation';
import { buildEvidencePrecheckResult } from '../../evidences/evidence-precheck';
import { scoreEvidenceConfidence } from '../../evidences/evidence-confidence.scorer';
import type { EvidenceExtractedFields } from '../../evidences/evidence-field-extractor';
import { normalizeEvidenceFields } from '../../evidences/evidence-field-normalizer';
import { matchEvidenceRegistry } from '../../evidences/evidence-registry-matcher';
import { StorageService } from '../../storage/storage.service';
import {
  isStaleEvidenceAnalysisJob,
  parseEvidenceAnalysisJobInput,
  recoverEvidenceAnalysisJobInputFromCurrentFile,
  type EvidenceAnalysisJobInput,
} from '../evidence-analysis-job-input';

const auditService = new AuditService();
const storageService = new StorageService();

type EvidenceOcrRecord = {
  id: string;
  evidenceName: string;
  criterion: Criterion;
  sourceType: EvidenceSourceType;
  applicationId: string | null;
  eventId: string | null;
  application?: {
    workspaceId: string;
    student?: {
      id: string;
      role: Role;
      fullName?: string | null;
      studentCode?: string | null;
      className?: string | null;
      faculty?: string | null;
    } | null;
  } | null;
  collectiveProfile?: {
    workspaceId: string;
    representative?: { id: string; role: Role } | null;
  } | null;
  evidenceFiles: Array<{ id: string; fileId: string; file: File }>;
  evidenceCard?: {
    confirmationStatus: string;
    requiresHumanConfirmation: boolean;
    confirmedFieldsJson: Prisma.JsonValue | null;
    confirmedByUserId: string | null;
    confirmedAt: Date | null;
    lastCorrectedAt: Date | null;
    analysisRevision: number;
  } | null;
};

type AuditActor = { id: string; role: Role } | null | undefined;

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
      evidenceCard: {
        select: {
          confirmationStatus: true,
          requiresHumanConfirmation: true,
          confirmedFieldsJson: true,
          confirmedByUserId: true,
          confirmedAt: true,
          lastCorrectedAt: true,
          analysisRevision: true,
        },
      },
    },
  });

  if (!evidence) throw new Error('Evidence not found for OCR job');

  const actor = evidence.application?.student ?? evidence.collectiveProfile?.representative;
  const workspaceId = evidence.application?.workspaceId ?? evidence.collectiveProfile?.workspaceId;
  if (!workspaceId) {
    throw new Error('Evidence workspace not found for OCR job');
  }

  const jobInput = await resolveEvidenceAnalysisJobInput(job, evidence);
  const newestFile = resolveNewestEvidenceFile(evidence.evidenceFiles);
  if (isStaleEvidenceAnalysisJob(jobInput, newestFile)) {
    await auditService.log({
      actorId: actor?.id,
      actorRole: actor?.role,
      action: auditActions.EVIDENCE_ANALYSIS_STALE_RESULT_IGNORED,
      entityType: 'indexing_job',
      entityId: job.id,
      applicationId: evidence.applicationId,
      evidenceId: evidence.id,
      workspaceId,
      metadata: {
        code: ErrorCodes.STALE_EVIDENCE_JOB_IGNORED,
        jobEvidenceFileId: jobInput.evidenceFileId,
        jobFileId: jobInput.fileId,
        currentEvidenceFileId: newestFile?.evidenceFileId ?? null,
        currentFileId: newestFile?.fileId ?? null,
      },
    });
    return {
      evidenceId: evidence.id,
      code: ErrorCodes.STALE_EVIDENCE_JOB_IGNORED,
      ignored: true,
      jobStatus: JobStatus.completed,
    };
  }

  const targetEvidenceFile = evidence.evidenceFiles.find(
    (link) => link.id === jobInput.evidenceFileId && link.fileId === jobInput.fileId,
  );
  const primaryFile = targetEvidenceFile?.file;
  if (!primaryFile) throw new Error('Evidence analysis job file binding was not found');

  await prisma.evidence.update({
    where: { id: evidence.id },
    data: { indexingStatus: IndexingStatus.ocr_processing },
  });

  const selectedProvider = createOpenAiOnlyEvidenceProvider(jobInput);
  return processProviderEvidenceAnalysis({
    job,
    jobInput,
    evidence,
    primaryFile,
    workspaceId,
    actor,
    provider: selectedProvider,
  });

}

async function resolveEvidenceAnalysisJobInput(
  job: IndexingJob,
  evidence: EvidenceOcrRecord,
): Promise<EvidenceAnalysisJobInput> {
  try {
    return parseEvidenceAnalysisJobInput(job.inputJson);
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== ErrorCodes.VALIDATION_ERROR) {
      throw error;
    }
    const recovered = recoverEvidenceAnalysisJobInputFromCurrentFile(job.targetId, evidence.evidenceFiles);
    if (!recovered) throw error;
    await prisma.indexingJob.update({
      where: { id: job.id },
      data: {
        inputJson: recovered,
        resultJson: Prisma.JsonNull,
      },
    });
    return recovered;
  }
}

async function processProviderEvidenceAnalysis(input: {
  job: IndexingJob;
  jobInput: EvidenceAnalysisJobInput;
  evidence: EvidenceOcrRecord;
  primaryFile: File;
  workspaceId: string;
  actor: AuditActor;
  provider: EvidenceAnalysisProvider;
}): Promise<Prisma.InputJsonObject> {
  const provider = input.provider;
  const startedAt = Date.now();

  await auditService.log({
    actorId: input.actor?.id,
    actorRole: input.actor?.role,
    action: auditActions.SMARTREADER_OCR_STARTED,
    entityType: 'indexing_job',
    entityId: input.job.id,
    applicationId: input.evidence.applicationId,
    evidenceId: input.evidence.id,
    workspaceId: input.workspaceId,
    metadata: {
      provider: provider.provider,
      fileId: input.primaryFile.id,
      evidenceFileId: input.jobInput.evidenceFileId,
      criterion: input.evidence.criterion,
      sourceType: input.evidence.sourceType,
    },
  });

  const fileBuffer = await loadEvidenceFileBuffer(input.primaryFile);
  if (fileBuffer.byteLength === 0) {
    throw new AppError(422, ErrorCodes.EMPTY_EVIDENCE_DOCUMENT, 'Evidence file is empty', {
      retryable: false,
    });
  }

  const analysis = await provider.analyze({
    evidenceId: input.evidence.id,
    evidenceFileId: input.jobInput.evidenceFileId,
    fileId: input.primaryFile.id,
    filename: input.primaryFile.originalName,
    mimeType: input.primaryFile.mimeType,
    fileBuffer,
    evidenceName: input.evidence.evidenceName,
    selectedCriterion: input.evidence.criterion,
    studentContext: {
      fullName: input.evidence.application?.student?.fullName,
      studentCode: input.evidence.application?.student?.studentCode,
    },
  });

  await prisma.evidence.update({
    where: { id: input.evidence.id },
    data: { indexingStatus: IndexingStatus.extracting },
  });

  const extractedFields = compactAnalysisFields(toFlatExtractedFields(analysis.fields));
  const normalizedFields = normalizeEvidenceFields(extractedFields);

  await prisma.evidence.update({
    where: { id: input.evidence.id },
    data: { indexingStatus: IndexingStatus.checking_registry },
  });

  const matched = await matchEvidenceRegistry(input.evidence.criterion, normalizedFields, input.workspaceId);
  const semanticWarningCodes = [
    ...(hasEventNameMismatchWithUserInput({
      evidenceName: input.evidence.evidenceName,
      extractedEventName: normalizedFields.event_name,
    })
      ? ['event_name_mismatch_with_user_input']
      : []),
    ...buildProfileConflictWarnings({
      profile: input.evidence.application?.student,
      fields: normalizedFields,
    }),
  ];
  const analysisWarnings = analysis.warnings.map((warning) => ({
    code: warning.code,
    message: warning.message,
    field: warning.field,
    severity: warning.severity,
  }));
  const scoring = scoreEvidenceConfidence({
    ocrSucceeded: true,
    fields: normalizedFields,
    evidenceName: input.evidence.evidenceName,
    matchedEventId: matched.eventId,
    warnings: [
      ...analysisWarnings.map((warning) => warning.code),
      ...matched.warnings,
      ...semanticWarningCodes,
    ],
  });
  const warningEntries = [
    ...analysisWarnings,
    ...buildWarnings([...scoring.warningCodes, ...matched.warnings, ...semanticWarningCodes], {
      warnings: [],
      warningMessages: [],
    }),
  ];
  const fieldConfidence = toFieldConfidenceMap(analysis.fields);
  const fieldLayers = buildEvidenceCardFieldLayers({
    evidenceName: input.evidence.evidenceName,
    sourceType: input.evidence.sourceType,
    criterion: input.evidence.criterion,
    extractedFields,
    normalizedFields,
    matchedEventId: matched.eventId,
    matchedParticipantId: matched.participantId,
    warnings: warningEntries,
    studentProfileFields: {
      studentName: input.evidence.application?.student?.fullName,
      studentCode: input.evidence.application?.student?.studentCode,
      className: input.evidence.application?.student?.className,
      faculty: input.evidence.application?.student?.faculty,
    },
  });
  const lowConfidenceFieldCount = Object.values(fieldConfidence).filter(
    (confidence) => typeof confidence === 'number' && confidence < 0.6,
  ).length;
  const missingFields = buildMissingFields(input.evidence.criterion, normalizedFields, warningEntries);
  const matchingStatusCode =
    matched.eventId && matched.participantId
      ? 'official_match_found'
      : matched.eventId
        ? 'official_match_not_found'
        : 'none';
  const confidence = Math.min(scoring.confidence, analysis.overallConfidence);
  const nextIndexingStatus =
    scoring.needsManualReview || analysis.warnings.some((warning) => warning.severity === 'blocking')
      ? IndexingStatus.needs_manual_review
      : IndexingStatus.indexed;
  const nextEvidenceStatus =
    nextIndexingStatus === IndexingStatus.needs_manual_review
      ? EvidenceStatus.needs_supplement
      : EvidenceStatus.indexed;

  const preserveStudentConfirmation = shouldPreserveStudentConfirmation(
    input.jobInput,
    input.evidence.evidenceCard,
  );
  const confirmationUpdate = preserveStudentConfirmation
    ? {}
    : {
        requiresHumanConfirmation: true,
        confirmationStatus: evidenceCardConfirmationStatuses.pending,
        confirmedFieldsJson: Prisma.JsonNull,
        confirmedByUserId: null,
        confirmedAt: null,
        lastCorrectedAt: null,
      };
  const now = new Date();
  const nextAnalysisRevision = (input.evidence.evidenceCard?.analysisRevision ?? 0) + 1;
  const evidencePrecheck = buildEvidencePrecheckResult({
    evidenceId: input.evidence.id,
    revision: nextAnalysisRevision,
    generatedAt: now,
    analysis,
    matchedProfile: input.evidence.application?.student,
    warningCodes: [...scoring.warningCodes, ...matched.warnings, ...semanticWarningCodes],
  });

  await prisma.$transaction(async (tx) => {
    await tx.evidenceCard.upsert({
      where: { evidenceId: input.evidence.id },
      update: {
        ocrText: analysis.summary,
        ocrLinesJson: [],
        ocrParagraphsJson: [],
        ocrTablesJson: [],
        extractedFieldsJson: extractedFields as Prisma.InputJsonValue,
        normalizedFieldsJson: normalizedFields as Prisma.InputJsonValue,
        warningsJson: warningEntries as Prisma.InputJsonValue,
        documentType: analysis.documentType,
        suggestedCriteriaJson: analysis.suggestedCriteria as Prisma.InputJsonValue,
        evidencePrecheckJson: evidencePrecheck as Prisma.InputJsonValue,
        evidencePrecheckedAt: now,
        matchedEventId: matched.eventId,
        matchedParticipantId: matched.participantId,
        matchedKnowledgeItemIds: [],
        confidence,
        provider: analysis.provider,
        providerModel: analysis.providerModel,
        promptVersion: analysis.promptVersion,
        sourceEvidenceFileId: input.jobInput.evidenceFileId,
        sourceFileId: input.primaryFile.id,
        analysisRevision: nextAnalysisRevision,
        analysedAt: now,
        fieldConfidenceJson: fieldConfidence as Prisma.InputJsonValue,
        ...confirmationUpdate,
        sourceEndpoint: `${analysis.provider}:responses`,
        smartreaderJobId: undefined,
        aiSummary: analysis.summary,
        rawAiResponse: undefined,
        rawResponseJson: undefined,
      },
      create: {
        evidenceId: input.evidence.id,
        ocrText: analysis.summary,
        ocrLinesJson: [],
        ocrParagraphsJson: [],
        ocrTablesJson: [],
        extractedFieldsJson: extractedFields as Prisma.InputJsonValue,
        normalizedFieldsJson: normalizedFields as Prisma.InputJsonValue,
        warningsJson: warningEntries as Prisma.InputJsonValue,
        documentType: analysis.documentType,
        suggestedCriteriaJson: analysis.suggestedCriteria as Prisma.InputJsonValue,
        evidencePrecheckJson: evidencePrecheck as Prisma.InputJsonValue,
        evidencePrecheckedAt: now,
        matchedEventId: matched.eventId,
        matchedParticipantId: matched.participantId,
        matchedKnowledgeItemIds: [],
        confidence,
        provider: analysis.provider,
        providerModel: analysis.providerModel,
        promptVersion: analysis.promptVersion,
        sourceEvidenceFileId: input.jobInput.evidenceFileId,
        sourceFileId: input.primaryFile.id,
        analysisRevision: nextAnalysisRevision,
        analysedAt: now,
        fieldConfidenceJson: fieldConfidence as Prisma.InputJsonValue,
        requiresHumanConfirmation: true,
        confirmationStatus: evidenceCardConfirmationStatuses.pending,
        confirmedFieldsJson: Prisma.JsonNull,
        confirmedByUserId: null,
        confirmedAt: null,
        lastCorrectedAt: null,
        sourceEndpoint: `${analysis.provider}:responses`,
        smartreaderJobId: undefined,
        aiSummary: analysis.summary,
        rawAiResponse: undefined,
        rawResponseJson: undefined,
      },
    });

    await tx.evidence.update({
      where: { id: input.evidence.id },
      data: {
        indexingStatus: nextIndexingStatus,
        status: nextEvidenceStatus,
        confidence,
        eventId: matched.eventId ?? input.evidence.eventId,
      },
    });
  });

  await auditService.log({
    actorId: input.actor?.id,
    actorRole: input.actor?.role,
    action: auditActions.EVIDENCE_CARD_GENERATED,
    entityType: 'evidence',
    entityId: input.evidence.id,
    applicationId: input.evidence.applicationId,
    evidenceId: input.evidence.id,
    workspaceId: input.workspaceId,
    metadata: {
      provider: analysis.provider,
      providerModel: analysis.providerModel,
      promptVersion: analysis.promptVersion,
      fileId: input.primaryFile.id,
      evidenceFileId: input.jobInput.evidenceFileId,
      criterion: input.evidence.criterion,
      sourceType: input.evidence.sourceType,
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
      latencyMs: analysis.latencyMs ?? Date.now() - startedAt,
      totalTokens: analysis.usage?.totalTokens,
    },
  });

  await auditService.log({
    actorId: input.actor?.id,
    actorRole: input.actor?.role,
    action: auditActions.AI_EVIDENCE_PRECHECK_COMPLETED,
    entityType: 'evidence',
    entityId: input.evidence.id,
    applicationId: input.evidence.applicationId,
    evidenceId: input.evidence.id,
    workspaceId: input.workspaceId,
    metadata: {
      provider: analysis.provider,
      criterion: input.evidence.criterion,
      fileId: input.primaryFile.id,
      evidenceFileId: input.jobInput.evidenceFileId,
      analysisRevision: nextAnalysisRevision,
      status: evidencePrecheck.status,
      recommendedAction: evidencePrecheck.recommendedAction,
      warningCount: evidencePrecheck.warnings.length,
      confirmationRequired: evidencePrecheck.confirmationRequired,
    },
  });

  if (scoring.needsManualReview || analysis.requiresHumanConfirmation) {
    await auditService.log({
      actorId: input.actor?.id,
      actorRole: input.actor?.role,
      action: auditActions.EVIDENCE_SENT_TO_HUMAN_VERIFICATION,
      entityType: 'evidence',
      entityId: input.evidence.id,
      applicationId: input.evidence.applicationId,
      evidenceId: input.evidence.id,
      workspaceId: input.workspaceId,
      metadata: {
        provider: analysis.provider,
        fileId: input.primaryFile.id,
        criterion: input.evidence.criterion,
        confidence,
        missingFieldCount: missingFields.length,
        warningCount: warningEntries.length,
      },
    });
  }

  if (preserveStudentConfirmation) {
    await auditService.log({
      actorId: input.actor?.id,
      actorRole: input.actor?.role,
      action: auditActions.EVIDENCE_MACHINE_LAYER_REFRESHED,
      entityType: 'evidence',
      entityId: input.evidence.id,
      applicationId: input.evidence.applicationId,
      evidenceId: input.evidence.id,
      workspaceId: input.workspaceId,
      metadata: {
        provider: analysis.provider,
        fileId: input.primaryFile.id,
        evidenceFileId: input.jobInput.evidenceFileId,
        confirmationStatus: input.evidence.evidenceCard?.confirmationStatus,
        preservedStudentFields: true,
      },
    });
  }

  return {
    evidenceId: input.evidence.id,
    confidence,
    indexingStatus: nextIndexingStatus,
    status: nextEvidenceStatus,
    provider: analysis.provider,
    providerModel: analysis.providerModel ?? null,
    promptVersion: analysis.promptVersion ?? null,
    requiresHumanConfirmation: true,
    matchedEventId: matched.eventId,
    matchedParticipantId: matched.participantId,
    warningCodes: scoring.warningCodes,
    jobStatus: JobStatus.completed,
  };
}

function createOpenAiOnlyEvidenceProvider(jobInput: EvidenceAnalysisJobInput): EvidenceAnalysisProvider {
  if (env.NODE_ENV === 'test' && jobInput.provider === 'mock') {
    return createEvidenceAnalysisProvider({ provider: 'mock' });
  }

  if (jobInput.provider && jobInput.provider !== 'openai') {
    throw new AppError(
      409,
      ErrorCodes.AI_PROVIDER_NOT_ALLOWED,
      'Manual evidence analysis is locked to OpenAI',
      {
        provider: jobInput.provider,
        evidenceFileId: jobInput.evidenceFileId,
        fileId: jobInput.fileId,
        retryable: false,
      },
    );
  }

  return createEvidenceAnalysisProvider({ provider: 'openai' });
}

function shouldPreserveStudentConfirmation(
  jobInput: EvidenceAnalysisJobInput,
  card: EvidenceOcrRecord['evidenceCard'],
) {
  if (jobInput.trigger !== 'student_assistant_reanalysis') return false;
  return (
    card?.confirmationStatus === evidenceCardConfirmationStatuses.confirmed ||
    card?.confirmationStatus === evidenceCardConfirmationStatuses.correctionRequired
  );
}

function buildWarnings(
  codes: string[],
  ocr: { warnings: string[]; warningMessages: string[] },
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
  if (normalized.includes('nghieng')) return 'document_image_skewed';
  if (normalized.includes('mat goc') || normalized.includes('matgoc')) {
    return 'document_image_cropped';
  }
  return 'document_quality_warning';
}

function warningMessage(code: string): string {
  const messages: Record<string, string> = {
    OCR_FAILED: 'Hệ thống chưa đọc được minh chứng.',
    MISSING_STUDENT_INFO: 'Thiếu họ tên hoặc mã số sinh viên.',
    MISSING_EVENT_NAME: 'Thiếu tên hoạt động hoặc nội dung minh chứng rõ ràng.',
    MISSING_DATE: 'Thiếu ngày cấp hoặc ngày tham gia.',
    MISSING_ORGANIZER: 'Thiếu đơn vị tổ chức hoặc xác nhận.',
    LOW_IMAGE_QUALITY: 'Ảnh/tệp có dấu hiệu mờ, nghiêng hoặc mất góc.',
    POSSIBLE_STUDENT_MISMATCH: 'Thông tin có dấu hiệu không khớp sinh viên.',
    LOW_CONFIDENCE: 'Độ tin cậy thấp, cần kiểm tra thủ công.',
    field_low_confidence: 'Một số thông tin AI đọc được chưa chắc chắn.',
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

function compactAnalysisFields(fields: Record<string, string | number | null>): EvidenceExtractedFields {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== null && value !== ''),
  ) as EvidenceExtractedFields;
}

async function loadEvidenceFileBuffer(file: File): Promise<Buffer> {
  if (file.storageType === FileStorageType.local) {
    return fs.readFile(path.resolve(env.UPLOAD_DIR, file.filePath));
  }

  const signedUrl = await storageService.getSignedReadUrl(file.filePath, 300, file.storageType);
  const response = await fetch(signedUrl);
  if (!response.ok) {
    throw new AppError(502, ErrorCodes.STORAGE_ERROR, 'Evidence file download failed', {
      retryable: true,
      status: response.status,
    });
  }
  return Buffer.from(await response.arrayBuffer());
}

function resolveNewestEvidenceFile(
  evidenceFiles: Array<{ id: string; fileId: string; file: { id: string; createdAt: Date } }>,
) {
  const newest = [...evidenceFiles].sort((left, right) => {
    const createdDiff = right.file.createdAt.getTime() - left.file.createdAt.getTime();
    if (createdDiff !== 0) return createdDiff;
    const fileIdDiff = right.file.id.localeCompare(left.file.id);
    if (fileIdDiff !== 0) return fileIdDiff;
    return right.id.localeCompare(left.id);
  })[0];
  return newest ? { evidenceFileId: newest.id, fileId: newest.fileId } : null;
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

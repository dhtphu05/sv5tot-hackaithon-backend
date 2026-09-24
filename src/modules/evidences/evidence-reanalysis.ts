import { EvidenceSourceType, IndexingStatus, JobStatus } from '@prisma/client';
import { evidenceCardConfirmationStatuses } from './evidence-card-confirmation';

export type EvidenceReanalysisReason =
  | 'legacy_smartreader_provider'
  | 'missing_provider_metadata'
  | 'active_file_changed'
  | 'low_confidence'
  | 'missing_identity'
  | 'missing_date'
  | 'missing_organizer'
  | 'invalid_field_shape'
  | 'stale_extraction';

export type EvidenceReanalysisDecision = {
  required: boolean;
  reasons: EvidenceReanalysisReason[];
  safeToAutoQueue: boolean;
  skipReason?: string;
};

type ReanalysisInput = {
  evidence: {
    sourceType: EvidenceSourceType | string;
    indexingStatus: IndexingStatus | string;
    status?: string | null;
  };
  activeFile?: {
    evidenceFileId: string;
    fileId: string;
    createdAt?: Date | null;
  } | null;
  evidenceCard?: {
    provider?: string | null;
    providerModel?: string | null;
    promptVersion?: string | null;
    sourceEndpoint?: string | null;
    sourceEvidenceFileId?: string | null;
    sourceFileId?: string | null;
    confidence?: number | null;
    fieldConfidenceJson?: unknown;
    extractedFieldsJson?: unknown;
    normalizedFieldsJson?: unknown;
    confirmationStatus?: string | null;
    analysedAt?: Date | null;
    updatedAt?: Date | null;
  } | null;
  activeJobs?: Array<{
    status: JobStatus | string;
    inputJson?: unknown;
  }>;
  providerConfigured: boolean;
  allowConfirmed?: boolean;
  now?: Date;
  staleAfterMs?: number;
};

const activeProcessingStatuses = new Set<string>([
  IndexingStatus.pending_indexing,
  IndexingStatus.ocr_processing,
  IndexingStatus.extracting,
  IndexingStatus.checking_registry,
]);

const activeJobStatuses = new Set<string>([JobStatus.queued, JobStatus.processing]);
const defaultStaleAfterMs = 1000 * 60 * 60 * 24 * 30;

export function shouldReanalyseLegacyEvidence(input: ReanalysisInput): EvidenceReanalysisDecision {
  if (input.evidence.sourceType === EvidenceSourceType.event_import) {
    return skipped('event_import');
  }
  if (!input.activeFile) return skipped('no_active_file');
  if (activeProcessingStatuses.has(String(input.evidence.indexingStatus))) {
    return skipped('analysis_already_active');
  }
  if (hasActiveJobForFile(input.activeJobs ?? [], input.activeFile)) {
    return skipped('analysis_job_already_active');
  }

  const card = input.evidenceCard;
  if (!card) {
    return {
      required: true,
      reasons: ['missing_provider_metadata'],
      safeToAutoQueue: input.providerConfigured,
    };
  }

  const status = card.confirmationStatus ?? evidenceCardConfirmationStatuses.pending;
  if (
    !input.allowConfirmed &&
    (status === evidenceCardConfirmationStatuses.confirmed ||
      status === evidenceCardConfirmationStatuses.correctionRequired)
  ) {
    return skipped('student_confirmed_or_corrected');
  }

  const fieldsResult = readFields(card);
  const reasons: EvidenceReanalysisReason[] = [];
  const currentFileMatches =
    card.sourceEvidenceFileId === input.activeFile.evidenceFileId &&
    card.sourceFileId === input.activeFile.fileId;
  if (
    card.provider === 'openai' &&
    currentFileMatches &&
    !isStale(card, input.activeFile, input.now ?? new Date(), input.staleAfterMs ?? defaultStaleAfterMs)
  ) {
    return skipped('fresh_openai_current_file');
  }
  if (card.provider === 'smartreader' || card.sourceEndpoint?.startsWith('ocr')) {
    reasons.push('legacy_smartreader_provider');
  }
  if (!card.provider || !card.providerModel || !card.promptVersion) {
    reasons.push('missing_provider_metadata');
  }
  if (
    card.sourceEvidenceFileId &&
    card.sourceFileId &&
    (card.sourceEvidenceFileId !== input.activeFile.evidenceFileId ||
      card.sourceFileId !== input.activeFile.fileId)
  ) {
    reasons.push('active_file_changed');
  }
  if (!card.sourceEvidenceFileId || !card.sourceFileId) {
    reasons.push('missing_provider_metadata');
  }
  if (typeof card.confidence === 'number' && card.confidence < 0.65) {
    reasons.push('low_confidence');
  }
  if (hasLowFieldConfidence(card.fieldConfidenceJson)) {
    reasons.push('low_confidence');
  }
  if (!fieldsResult.valid) {
    reasons.push('invalid_field_shape');
  } else {
    const fields = fieldsResult.fields;
    if (!hasAnyValue(fields, ['student_name', 'student_code'])) reasons.push('missing_identity');
    if (!hasAnyValue(fields, ['issue_date', 'activity_date'])) reasons.push('missing_date');
    if (!hasAnyValue(fields, ['organizer', 'event_name'])) reasons.push('missing_organizer');
  }
  if (isStale(card, input.activeFile, input.now ?? new Date(), input.staleAfterMs ?? defaultStaleAfterMs)) {
    reasons.push('stale_extraction');
  }

  const uniqueReasons = [...new Set(reasons)];
  return {
    required: uniqueReasons.length > 0,
    reasons: uniqueReasons,
    safeToAutoQueue: uniqueReasons.length > 0 && input.providerConfigured,
  };
}

function skipped(skipReason: string): EvidenceReanalysisDecision {
  return { required: false, reasons: [], safeToAutoQueue: false, skipReason };
}

function hasActiveJobForFile(
  jobs: Array<{ status: JobStatus | string; inputJson?: unknown }>,
  activeFile: { evidenceFileId: string; fileId: string },
) {
  return jobs.some((job) => {
    if (!activeJobStatuses.has(String(job.status))) return false;
    const input = asRecord(job.inputJson);
    return input?.evidenceFileId === activeFile.evidenceFileId && input?.fileId === activeFile.fileId;
  });
}

function readFields(card: {
  normalizedFieldsJson?: unknown;
  extractedFieldsJson?: unknown;
}): { valid: true; fields: Record<string, unknown> } | { valid: false; fields: Record<string, unknown> } {
  const normalized = asRecord(card.normalizedFieldsJson);
  const extracted = asRecord(card.extractedFieldsJson);
  if (!normalized && !extracted) return { valid: false, fields: {} };
  return { valid: true, fields: normalized ?? extracted ?? {} };
}

function hasAnyValue(fields: Record<string, unknown>, keys: string[]) {
  return keys.some((key) => {
    const value = fields[key];
    return value !== null && value !== undefined && String(value).trim() !== '';
  });
}

function hasLowFieldConfidence(value: unknown) {
  const record = asRecord(value);
  if (!record) return false;
  return Object.values(record).some((confidence) => {
    return typeof confidence === 'number' && Number.isFinite(confidence) && confidence < 0.55;
  });
}

function isStale(
  card: { analysedAt?: Date | null; updatedAt?: Date | null },
  activeFile: { createdAt?: Date | null },
  now: Date,
  staleAfterMs: number,
) {
  const analysedAt = card.analysedAt ?? card.updatedAt ?? null;
  if (!analysedAt) return true;
  if (activeFile.createdAt && analysedAt.getTime() < activeFile.createdAt.getTime()) return true;
  return now.getTime() - analysedAt.getTime() > staleAfterMs;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

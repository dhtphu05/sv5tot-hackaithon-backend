import { EvidenceStatus, IndexingStatus } from '@prisma/client';

export type ApplicationFreshnessInput = {
  updatedAt: Date;
  evidences: Array<{ updatedAt: Date }>;
  metrics: Array<{ updatedAt: Date }>;
  requirementResponses: Array<{ updatedAt: Date }>;
};

export type ProcessingEvidenceInput = {
  evidences: Array<{
    id?: string;
    criterion?: string;
    status: EvidenceStatus;
    indexingStatus: IndexingStatus;
  }>;
};

export function findProcessingEvidence<T extends ProcessingEvidenceInput['evidences'][number]>(
  application: { evidences: T[] },
): T | undefined {
  return application.evidences.find((evidence) =>
    hasActiveEvidenceProcessing({ evidences: [evidence] }),
  );
}

export function hasActiveEvidenceProcessing(application: ProcessingEvidenceInput) {
  const activeStatuses = new Set<IndexingStatus>([
    IndexingStatus.pending_indexing,
    IndexingStatus.ocr_processing,
    IndexingStatus.extracting,
    IndexingStatus.checking_registry,
  ]);
  return application.evidences.some(
    (evidence) =>
      evidence.status === EvidenceStatus.pending_indexing ||
      activeStatuses.has(evidence.indexingStatus),
  );
}

export function isApplicationPrecheckStale(
  application: ApplicationFreshnessInput,
  precheckCreatedAt?: Date | null,
) {
  if (!precheckCreatedAt) return true;
  const timestamps = [
    application.updatedAt,
    ...application.evidences.map((item) => item.updatedAt),
    ...application.metrics.map((item) => item.updatedAt),
    ...application.requirementResponses.map((item) => item.updatedAt),
  ];
  return timestamps.some((timestamp) => timestamp > precheckCreatedAt);
}

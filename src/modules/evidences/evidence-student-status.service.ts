import type { Criterion, EvidenceSourceType, EvidenceStatus, IndexingStatus, Prisma } from '@prisma/client';
import {
  resolveStudentStatusForCard,
  type EvidenceMatchingStatus,
  type EvidenceStudentStatus,
} from '../../shared/dto/evidence-student-status';

export function decideEvidenceStudentStatus(input: {
  sourceType: EvidenceSourceType | string;
  readableSummary?: Prisma.JsonValue | Record<string, unknown> | null;
  missingFields?: unknown[] | null;
  warnings?: Prisma.JsonValue | unknown[] | null;
  matchingStatus?: EvidenceMatchingStatus | null;
  indexingStatus: IndexingStatus | string;
  status?: EvidenceStatus | string;
  criterion?: Criterion | string;
  ocrText?: string | null;
}): EvidenceStudentStatus {
  if (input.matchingStatus?.code === 'official_match_found') {
    return resolveStudentStatusForCard({
      sourceType: 'event_import',
      status: input.status ?? 'under_review',
      indexingStatus: input.indexingStatus,
      criterion: input.criterion ?? 'volunteer',
      fields: input.readableSummary as Prisma.JsonValue,
      warnings: input.warnings as Prisma.JsonValue,
      ocrText: input.ocrText,
      matchedEventId: input.matchingStatus.matchedEventId,
      matchedParticipantId: input.matchingStatus.matchedParticipantId,
    });
  }

  return resolveStudentStatusForCard({
    sourceType: input.sourceType,
    status: input.status ?? 'under_review',
    indexingStatus: input.indexingStatus,
    criterion: input.criterion ?? 'volunteer',
    fields: input.readableSummary as Prisma.JsonValue,
    warnings: input.warnings as Prisma.JsonValue,
    ocrText: input.ocrText,
    matchedEventId: input.matchingStatus?.matchedEventId,
    matchedParticipantId: input.matchingStatus?.matchedParticipantId,
  });
}

export type { EvidenceStudentStatus };

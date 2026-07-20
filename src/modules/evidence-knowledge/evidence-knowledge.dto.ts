import type {
  ApprovedEvidenceApprovalSource,
  Criterion,
  EventRegistryAlias,
  Level,
} from '@prisma/client';
import type {
  ApprovedPrecedentDetailRecord,
  ApprovedPrecedentSearchRecord,
} from './evidence-knowledge.repository';

export type EvidenceKnowledgeMatchReason =
  'canonical_title' | 'verified_alias' | 'acronym' | 'organizer' | 'year' | 'ocr' | 'typo';

export type OfficerEvidenceKnowledgeSearchItemDto = {
  eventId: string;
  canonicalTitle: string;
  aliases: string[];
  criterion: Criterion;
  organizer: string | null;
  year: number | null;
  applicableLevel: Level | null;
  acceptedCount: number;
  approvalSources: ApprovedEvidenceApprovalSource[];
  hasResolutionPrecedent: boolean;
  matchReasons: EvidenceKnowledgeMatchReason[];
};

export type OfficerEvidenceKnowledgeSearchResponseDto = {
  items: OfficerEvidenceKnowledgeSearchItemDto[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type OfficerEvidenceKnowledgeEventDetailDto = {
  eventId: string;
  canonicalTitle: string;
  aliases: string[];
  criterion: Criterion;
  organizer: string | null;
  organizerLevel: Level | null;
  year: number | null;
  applicableLevel: Level | null;
  resolutionPrecedent: {
    precedentId: string;
    resolutionCaseId: string | null;
    approvedAt: Date;
  } | null;
  acceptedEvidence: Array<{
    precedentId: string;
    evidenceId: string;
    evidenceName: string;
    approvalSource: ApprovedEvidenceApprovalSource;
    criterion: Criterion;
    applicableLevel: Level | null;
    eventYear: number | null;
    schoolYear: string | null;
    criteriaVersion: { id: string; versionName: string; schoolYear: string; level: Level } | null;
    previewFile: {
      id: string;
      originalName: string;
      mimeType: string;
      fileSize: number;
    } | null;
    ocrMetadata: {
      hasOcrText: boolean;
      extractedFields: unknown;
      warningsCount: number;
      confidence: number | null;
    };
    auditSummary: unknown;
    createdAt: Date;
  }>;
};

export function aliasTexts(aliases: EventRegistryAlias[]): string[] {
  return Array.from(new Set(aliases.map((alias) => alias.alias).filter(Boolean)));
}

export function toOfficerEvidenceKnowledgeEventDetailDto(
  eventId: string,
  records: ApprovedPrecedentDetailRecord[],
): OfficerEvidenceKnowledgeEventDetailDto {
  const first = records[0];
  if (!first) {
    throw new Error(`Cannot map empty precedent list for event ${eventId}`);
  }
  const resolutionPrecedent = records.find(
    (record) => record.approvalSource === 'resolution' || record.sourceResolutionCaseId,
  );

  return {
    eventId,
    canonicalTitle: first.event.eventName,
    aliases: aliasTexts(first.event.aliases),
    criterion: first.event.criterion,
    organizer: first.organizer ?? first.event.organizer,
    organizerLevel: first.organizerLevel ?? first.event.organizerLevel,
    year: first.eventYear,
    applicableLevel: first.applicableLevel,
    resolutionPrecedent: resolutionPrecedent
      ? {
          precedentId: resolutionPrecedent.id,
          resolutionCaseId: resolutionPrecedent.sourceResolutionCaseId,
          approvedAt: resolutionPrecedent.updatedAt,
        }
      : null,
    acceptedEvidence: records.map((record) => ({
      precedentId: record.id,
      evidenceId: record.sourceEvidenceId,
      evidenceName: record.sourceEvidence.evidenceName,
      approvalSource: record.approvalSource,
      criterion: record.criterion,
      applicableLevel: record.applicableLevel,
      eventYear: record.eventYear,
      schoolYear: record.schoolYear,
      criteriaVersion: record.criteriaVersion
        ? {
            id: record.criteriaVersion.id,
            versionName: record.criteriaVersion.versionName,
            schoolYear: record.criteriaVersion.schoolYear,
            level: record.criteriaVersion.level,
          }
        : null,
      previewFile: record.previewFile
        ? {
            id: record.previewFile.id,
            originalName: record.previewFile.originalName,
            mimeType: record.previewFile.mimeType,
            fileSize: record.previewFile.fileSize,
          }
        : null,
      ocrMetadata: {
        hasOcrText: Boolean(record.sourceEvidenceCard?.ocrText),
        extractedFields: record.sourceEvidenceCard?.extractedFieldsJson ?? null,
        warningsCount: Array.isArray(record.sourceEvidenceCard?.warningsJson)
          ? record.sourceEvidenceCard.warningsJson.length
          : 0,
        confidence: record.sourceEvidenceCard?.confidence ?? null,
      },
      auditSummary: record.auditSummaryJson,
      createdAt: record.createdAt,
    })),
  };
}

export type ScoredPrecedentGroup = {
  eventId: string;
  canonicalTitle: string;
  aliases: string[];
  criterion: Criterion;
  organizer: string | null;
  year: number | null;
  applicableLevel: Level | null;
  acceptedCount: number;
  approvalSources: ApprovedEvidenceApprovalSource[];
  hasResolutionPrecedent: boolean;
  matchReasons: EvidenceKnowledgeMatchReason[];
  score: number;
  records: ApprovedPrecedentSearchRecord[];
};

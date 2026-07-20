import {
  ApprovedEvidenceApprovalSource,
  EventRegistryAliasType,
  EventRegistryAliasVerificationSource,
  EventStatus,
  EvidenceStatus,
  Level,
  type Criterion,
  type Prisma,
} from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { createApplicationAudit } from '../applications/application.helpers';
import { extractYear, normalizeEvidenceKnowledgeText } from './evidence-knowledge.normalizer';

type DbClient = Prisma.TransactionClient | typeof prisma;

export class EvidenceKnowledgePublisher {
  async publishAcceptedEvidence(
    tx: DbClient,
    user: AuthenticatedUser,
    input: {
      evidenceId: string;
      reviewTaskId?: string | null;
      resolutionCaseId?: string | null;
      approvalSource: ApprovedEvidenceApprovalSource;
      note?: string | null;
    },
  ) {
    const evidence = await tx.evidence.findUnique({
      where: { id: input.evidenceId },
      include: {
        event: true,
        evidenceCard: true,
        evidenceFiles: { include: { file: true }, take: 1 },
        application: { include: { student: true } },
      },
    });
    if (!evidence || evidence.status !== EvidenceStatus.accepted || !evidence.application) {
      return null;
    }

    const event = await this.resolveCanonicalEvent(tx, user, {
      approvalSource: input.approvalSource,
      workspaceId: evidence.application.workspaceId,
      evidenceName: evidence.evidenceName,
      criterion: evidence.criterion,
      eventId: evidence.eventId ?? evidence.evidenceCard?.matchedEventId ?? null,
      targetLevel: evidence.application.targetLevel,
      schoolYear: evidence.application.schoolYear,
    });
    if (!event) return null;

    if (!evidence.eventId || evidence.eventId !== event.id) {
      await tx.evidence.update({ where: { id: evidence.id }, data: { eventId: event.id } });
    }

    await this.ensureAlias(tx, user, {
      workspaceId: evidence.application.workspaceId,
      eventId: event.id,
      criterion: evidence.criterion,
      alias: evidence.evidenceName,
      approvalSource: input.approvalSource,
    });

    const criteriaVersion = await tx.criteriaVersion.findFirst({
      where: {
        workspaceId: evidence.application.workspaceId,
        schoolYear: evidence.application.schoolYear,
        level: evidence.application.targetLevel,
        isActive: true,
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    const previewFileId = evidence.evidenceFiles[0]?.fileId ?? null;
    const ocrSearchKey = normalizeEvidenceKnowledgeText(
      [
        evidence.evidenceCard?.ocrText,
        flattenJsonText(evidence.evidenceCard?.extractedFieldsJson),
        flattenJsonText(evidence.evidenceCard?.normalizedFieldsJson),
      ].join(' '),
    );
    const eventYear = event.startDate
      ? event.startDate.getFullYear()
      : extractYear(event.eventName);
    const auditSummary = {
      approvalSource: input.approvalSource,
      reviewTaskId: input.reviewTaskId ?? null,
      resolutionCaseId: input.resolutionCaseId ?? null,
      approvedAt: new Date().toISOString(),
      note: input.note ?? null,
    } satisfies Prisma.InputJsonObject;

    const precedent = await tx.approvedEvidencePrecedent.upsert({
      where: { sourceEvidenceId: evidence.id },
      create: {
        workspaceId: evidence.application.workspaceId,
        criterion: evidence.criterion,
        eventId: event.id,
        sourceEvidenceId: evidence.id,
        sourceEvidenceCardId: evidence.evidenceCard?.id ?? null,
        sourceReviewTaskId: input.reviewTaskId ?? null,
        sourceResolutionCaseId: input.resolutionCaseId ?? null,
        previewFileId,
        approvalSource: input.approvalSource,
        organizer: event.organizer,
        organizerLevel: event.organizerLevel,
        applicableLevel: evidence.application.targetLevel,
        eventYear,
        schoolYear: evidence.application.schoolYear,
        criteriaVersionId: criteriaVersion?.id ?? null,
        normalizedTitleKey: normalizeEvidenceKnowledgeText(event.eventName),
        normalizedOrganizerKey: normalizeEvidenceKnowledgeText(event.organizer),
        ocrSearchKey: ocrSearchKey || null,
        ocrMetadataJson: buildOcrMetadata(evidence.evidenceCard),
        auditSummaryJson: auditSummary,
        status: 'active',
        createdBy: user.id,
      },
      update: {
        eventId: event.id,
        sourceEvidenceCardId: evidence.evidenceCard?.id ?? null,
        sourceReviewTaskId: input.reviewTaskId ?? null,
        sourceResolutionCaseId: input.resolutionCaseId ?? null,
        previewFileId,
        approvalSource: input.approvalSource,
        organizer: event.organizer,
        organizerLevel: event.organizerLevel,
        applicableLevel: evidence.application.targetLevel,
        eventYear,
        schoolYear: evidence.application.schoolYear,
        criteriaVersionId: criteriaVersion?.id ?? null,
        normalizedTitleKey: normalizeEvidenceKnowledgeText(event.eventName),
        normalizedOrganizerKey: normalizeEvidenceKnowledgeText(event.organizer),
        ocrSearchKey: ocrSearchKey || null,
        ocrMetadataJson: buildOcrMetadata(evidence.evidenceCard),
        auditSummaryJson: auditSummary,
        status: 'active',
      },
    });

    await createApplicationAudit(tx, {
      actorId: user.id,
      actorRole: user.role,
      action: 'APPROVED_EVIDENCE_PRECEDENT_PUBLISHED',
      targetType: 'approved_evidence_precedent',
      targetId: precedent.id,
      applicationId: evidence.applicationId,
      workspaceId: evidence.application.workspaceId,
      evidenceId: evidence.id,
      eventId: event.id,
      afterStateJson: {
        approvalSource: precedent.approvalSource,
        criterion: precedent.criterion,
        sourceEvidenceId: precedent.sourceEvidenceId,
        sourceReviewTaskId: precedent.sourceReviewTaskId,
        sourceResolutionCaseId: precedent.sourceResolutionCaseId,
      },
      note: input.note ?? undefined,
    });

    return precedent;
  }

  private async resolveCanonicalEvent(
    tx: DbClient,
    user: AuthenticatedUser,
    input: {
      approvalSource: ApprovedEvidenceApprovalSource;
      workspaceId: string;
      evidenceName: string;
      criterion: Criterion;
      eventId: string | null;
      targetLevel: Level;
      schoolYear: string;
    },
  ) {
    if (input.eventId) {
      const event = await tx.eventRegistry.findFirst({
        where: { id: input.eventId, workspaceId: input.workspaceId },
      });
      if (event) return event;
    }

    const normalizedEvidenceName = normalizeEvidenceKnowledgeText(input.evidenceName);
    const candidates = await tx.eventRegistry.findMany({
      where: { workspaceId: input.workspaceId, criterion: input.criterion },
      take: 100,
      orderBy: { updatedAt: 'desc' },
    });
    const existing = candidates.find(
      (candidate) => normalizeEvidenceKnowledgeText(candidate.eventName) === normalizedEvidenceName,
    );
    if (existing) return existing;

    if (input.approvalSource !== ApprovedEvidenceApprovalSource.resolution) {
      return null;
    }

    return tx.eventRegistry.create({
      data: {
        workspaceId: input.workspaceId,
        eventName: input.evidenceName,
        criterion: input.criterion,
        organizer: 'Chưa xác định',
        organizerLevel: input.targetLevel,
        status: EventStatus.active,
        rosterIndexed: false,
        createdBy: user.id,
      },
    });
  }

  private async ensureAlias(
    tx: DbClient,
    user: AuthenticatedUser,
    input: {
      workspaceId: string;
      eventId: string;
      criterion: Criterion;
      alias: string;
      approvalSource: ApprovedEvidenceApprovalSource;
    },
  ) {
    const normalizedAliasKey = normalizeEvidenceKnowledgeText(input.alias);
    if (!normalizedAliasKey) return null;
    const verificationSource =
      input.approvalSource === ApprovedEvidenceApprovalSource.resolution
        ? EventRegistryAliasVerificationSource.resolution
        : EventRegistryAliasVerificationSource.officer;
    return tx.eventRegistryAlias.upsert({
      where: {
        workspaceId_eventId_normalizedAliasKey: {
          workspaceId: input.workspaceId,
          eventId: input.eventId,
          normalizedAliasKey,
        },
      },
      create: {
        workspaceId: input.workspaceId,
        eventId: input.eventId,
        criterion: input.criterion,
        alias: input.alias,
        normalizedAliasKey,
        aliasType: EventRegistryAliasType.alias,
        verificationSource,
        createdBy: user.id,
      },
      update: { alias: input.alias, verificationSource },
    });
  }
}

function buildOcrMetadata(
  card: {
    ocrText: string | null;
    extractedFieldsJson: Prisma.JsonValue | null;
    warningsJson: Prisma.JsonValue | null;
    confidence: number | null;
  } | null,
): Prisma.InputJsonObject {
  return {
    hasOcrText: Boolean(card?.ocrText),
    extractedFieldKeys:
      card?.extractedFieldsJson &&
      typeof card.extractedFieldsJson === 'object' &&
      !Array.isArray(card.extractedFieldsJson)
        ? Object.keys(card.extractedFieldsJson)
        : [],
    warningsCount: Array.isArray(card?.warningsJson) ? card.warningsJson.length : 0,
    confidence: card?.confidence ?? null,
  };
}

function flattenJsonText(value: Prisma.JsonValue | null | undefined): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(flattenJsonText).join(' ');
  if (typeof value === 'object') return Object.values(value).map(flattenJsonText).join(' ');
  return '';
}

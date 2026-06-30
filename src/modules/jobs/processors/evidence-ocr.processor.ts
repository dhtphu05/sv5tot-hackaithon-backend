// Owns OCR job processing for evidence files.
import {
  EvidenceStatus,
  IndexingStatus,
  JobStatus,
  type IndexingJob,
  type Prisma,
} from '@prisma/client';
import { VnptSmartReaderClient } from '../../../infrastructure/vnpt/vnpt-smartreader.client';
import { prisma } from '../../../infrastructure/database/prisma';
import { auditActions } from '../../../shared/constants/application';
import { createApplicationAudit } from '../../applications/application.helpers';
import { generateEvidenceCard } from '../../ai/evidence-card.generator';

const smartReaderClient = new VnptSmartReaderClient();

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
      },
    },
  });

  if (!evidence) {
    throw new Error('Evidence not found for OCR job');
  }

  const primaryFile = evidence.evidenceFiles[0]?.file;
  if (!primaryFile) {
    throw new Error('Evidence has no files for OCR');
  }

  const smartReaderResult = await smartReaderClient.extractEvidence({
    originalName: primaryFile.originalName,
    mimeType: primaryFile.mimeType,
  });

  const matchedKnowledgeItems = await prisma.knowledgeBaseItem.findMany({
    where: {
      criterion: evidence.criterion,
      OR: [
        { evidenceName: { contains: evidence.evidenceName, mode: 'insensitive' } },
        {
          eventName: {
            contains: smartReaderResult.extractedFields.activityName ?? evidence.evidenceName,
            mode: 'insensitive',
          },
        },
      ],
    },
    take: 3,
  });

  const baseCard = generateEvidenceCard({
    evidence,
    smartReaderResult,
    matchedKnowledgeItemIds: matchedKnowledgeItems.map((item) => item.id),
  });
  const generatedCard = evidence.collectiveProfileId
    ? {
        ...baseCard,
        aiSummary:
          'Đây là thẻ minh chứng tập thể được hệ thống đọc tự động. Kết quả cuối cùng cần cán bộ/Hội đồng xác nhận.',
      }
    : baseCard;

  const criticalWarnings = generatedCard.warningsJson.filter((warning) =>
    ['BLURRY_FILE', 'CRITERION_MISMATCH', 'LOW_CONFIDENCE'].includes(warning.code),
  );
  const nextIndexingStatus =
    generatedCard.confidence >= 0.75 && criticalWarnings.length === 0
      ? IndexingStatus.indexed
      : IndexingStatus.needs_manual_review;
  const nextEvidenceStatus =
    generatedCard.confidence >= 0.75 && criticalWarnings.length === 0
      ? EvidenceStatus.indexed
      : EvidenceStatus.needs_supplement;

  await prisma.$transaction(async (tx) => {
    const existingCard = await tx.evidenceCard.findUnique({
      where: { evidenceId: evidence.id },
    });

    await tx.evidenceCard.upsert({
      where: { evidenceId: evidence.id },
      update: {
        ocrText: generatedCard.ocrText,
        extractedFieldsJson: generatedCard.extractedFieldsJson as Prisma.InputJsonValue,
        warningsJson: generatedCard.warningsJson as Prisma.InputJsonValue,
        matchedKnowledgeItemIds: generatedCard.matchedKnowledgeItemIds as Prisma.InputJsonValue,
        confidence: generatedCard.confidence,
        aiSummary: generatedCard.aiSummary,
        rawAiResponse: generatedCard.rawAiResponse as Prisma.InputJsonValue,
      },
      create: {
        evidenceId: evidence.id,
        ocrText: generatedCard.ocrText,
        extractedFieldsJson: generatedCard.extractedFieldsJson as Prisma.InputJsonValue,
        warningsJson: generatedCard.warningsJson as Prisma.InputJsonValue,
        matchedKnowledgeItemIds: generatedCard.matchedKnowledgeItemIds as Prisma.InputJsonValue,
        confidence: generatedCard.confidence,
        aiSummary: generatedCard.aiSummary,
        rawAiResponse: generatedCard.rawAiResponse as Prisma.InputJsonValue,
      },
    });

    await tx.evidence.update({
      where: { id: evidence.id },
      data: {
        indexingStatus: nextIndexingStatus,
        status: nextEvidenceStatus,
        confidence: generatedCard.confidence,
      },
    });

    const actor = evidence.application?.student ?? evidence.collectiveProfile?.representative;
    await createApplicationAudit(tx, {
      actorId: actor?.id,
      actorRole: actor?.role,
      action: existingCard
        ? auditActions.EVIDENCE_CARD_UPDATED
        : auditActions.EVIDENCE_CARD_CREATED,
      targetType: 'evidence',
      targetId: evidence.id,
      applicationId: evidence.applicationId ?? undefined,
      collectiveProfileId: evidence.collectiveProfileId ?? undefined,
      afterStateJson: {
        confidence: generatedCard.confidence,
        indexingStatus: nextIndexingStatus,
        status: nextEvidenceStatus,
      },
    });
  });

  return {
    evidenceId: evidence.id,
    confidence: generatedCard.confidence,
    indexingStatus: nextIndexingStatus,
    status: nextEvidenceStatus,
    warnings: generatedCard.warningsJson,
    jobStatus: JobStatus.completed,
  };
}

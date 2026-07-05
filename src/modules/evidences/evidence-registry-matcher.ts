import type { Criterion } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { resolveExactParticipantNameMatch } from '../event-registry/event-participant-matching';
import type { EvidenceExtractedFields } from './evidence-field-extractor';

export type EvidenceRegistryMatch = {
  eventId: string | null;
  participantId: string | null;
  warnings: string[];
};

export async function matchEvidenceRegistry(
  criterion: Criterion,
  fields: EvidenceExtractedFields,
): Promise<EvidenceRegistryMatch> {
  if (fields.document_type === 'transcript') {
    return { eventId: null, participantId: null, warnings: [] };
  }

  const eventName = fields.event_name;
  const event = eventName
    ? await prisma.eventRegistry.findFirst({
        where: {
          criterion,
          eventName: { contains: eventName.slice(0, 80), mode: 'insensitive' },
        },
        orderBy: { updatedAt: 'desc' },
      })
    : null;

  const participantMatch = event
    ? await matchParticipant(event.id, fields)
    : { participantId: null, warnings: [] };

  return {
    eventId: event?.id ?? null,
    participantId: participantMatch.participantId,
    warnings: event ? participantMatch.warnings : ['not_matched_registry'],
  };
}

async function matchParticipant(eventId: string, fields: EvidenceExtractedFields) {
  const warnings: string[] = [];

  if (fields.student_name) {
    const candidates = await prisma.eventParticipant.findMany({
      where: { eventId },
      select: { id: true, studentName: true },
    });
    const nameMatch = resolveExactParticipantNameMatch(candidates, fields.student_name);
    if (nameMatch.status === 'matched') {
      return { participantId: nameMatch.participant.id, warnings };
    }
    warnings.push(
      nameMatch.status === 'duplicate'
        ? 'participant_name_duplicate'
        : 'participant_name_not_matched',
    );
    if (nameMatch.status === 'duplicate') {
      return { participantId: null, warnings };
    }
  }

  const participant = fields.student_code
    ? await prisma.eventParticipant.findFirst({
        where: { eventId, studentCode: fields.student_code },
        select: { id: true },
      })
    : null;
  if (!participant) warnings.push('participant_not_matched_registry');

  return { participantId: participant?.id ?? null, warnings };
}

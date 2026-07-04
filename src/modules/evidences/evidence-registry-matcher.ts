import type { Criterion } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
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

  const participant =
    event && fields.student_code
      ? await prisma.eventParticipant.findFirst({
          where: { eventId: event.id, studentCode: fields.student_code },
        })
      : null;

  return {
    eventId: event?.id ?? null,
    participantId: participant?.id ?? null,
    warnings: event ? [] : ['not_matched_registry'],
  };
}

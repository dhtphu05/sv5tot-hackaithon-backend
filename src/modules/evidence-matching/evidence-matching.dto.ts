import type { Criterion, EventRegistry, Level } from '@prisma/client';

type StudentOfficialEvent = Pick<
  EventRegistry,
  'id' | 'eventName' | 'organizer' | 'organizerLevel' | 'criterion'
>;

type StudentReferenceEvent = Pick<EventRegistry, 'id' | 'eventName' | 'criterion'>;

export type StudentOfficialEventLibraryItemDto = {
  eventId: string;
  title: string;
  organizer: string | null;
  organizerLevel: Level | null;
  criterion: Criterion;
  state: 'available' | 'already_imported';
};

export type StudentReferenceEventLibraryItemDto = {
  eventId: string;
  title: string;
  criterion: Criterion;
  approvedUsageCount: number;
};

export function toStudentReferenceEventLibraryItemDto(
  event: StudentReferenceEvent,
  approvedUsageCount = 0,
): StudentReferenceEventLibraryItemDto {
  return {
    eventId: event.id,
    title: event.eventName,
    criterion: event.criterion,
    approvedUsageCount,
  };
}

export function toStudentOfficialEventLibraryItemDto(
  event: StudentOfficialEvent,
  alreadyImported: boolean,
): StudentOfficialEventLibraryItemDto {
  return {
    eventId: event.id,
    title: event.eventName,
    organizer: event.organizer ?? null,
    organizerLevel: event.organizerLevel ?? null,
    criterion: event.criterion,
    state: alreadyImported ? 'already_imported' : 'available',
  };
}

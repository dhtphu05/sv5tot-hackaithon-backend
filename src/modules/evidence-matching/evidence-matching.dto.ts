import type { Criterion, EventRegistry, Level } from '@prisma/client';

type StudentOfficialEvent = Pick<
  EventRegistry,
  'id' | 'eventName' | 'organizer' | 'organizerLevel' | 'criterion'
>;

type StudentReferenceEvent = Pick<EventRegistry, 'id' | 'eventName'>;

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
};

export function toStudentReferenceEventLibraryItemDto(
  event: StudentReferenceEvent,
): StudentReferenceEventLibraryItemDto {
  return {
    eventId: event.id,
    title: event.eventName,
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

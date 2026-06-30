// Owns event registry, roster indexing, participants, and application imports.
import { EventStatus, Role, type Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import type { AuthenticatedUser } from '../../shared/types/auth';
import type { ListEventsQuery, ParticipantsQuery } from './event-registry.validation';

export const eventInclude = {
  eventFiles: {
    include: { file: true },
    orderBy: { createdAt: 'desc' },
  },
  sampleCertificateFile: true,
} satisfies Prisma.EventRegistryInclude;

export class EventRegistryRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  async list(user: AuthenticatedUser, query: ListEventsQuery) {
    const studentVisibility =
      user.role === Role.student || user.role === Role.class_representative
        ? { status: EventStatus.active, rosterIndexed: true }
        : query.status
          ? { status: query.status }
          : {};

    const where: Prisma.EventRegistryWhereInput = {
      ...studentVisibility,
      ...(query.criterion ? { criterion: query.criterion } : {}),
      ...(query.organizerLevel ? { organizerLevel: query.organizerLevel } : {}),
      ...(query.q
        ? {
            OR: [
              { eventName: { contains: query.q, mode: 'insensitive' } },
              { organizer: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const skip = (query.page - 1) * query.limit;

    const [items, total] = await this.db.$transaction([
      this.db.eventRegistry.findMany({
        where,
        include: eventInclude,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: query.limit,
      }),
      this.db.eventRegistry.count({ where }),
    ]);

    return { items, total };
  }

  findById(id: string) {
    return this.db.eventRegistry.findUnique({ where: { id }, include: eventInclude });
  }

  findLatestEventFile(eventId: string) {
    return this.db.eventFile.findFirst({
      where: { eventId },
      include: { file: true, event: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  findEventFile(id: string) {
    return this.db.eventFile.findUnique({ where: { id }, include: { file: true, event: true } });
  }

  findLatestCompletedRosterJob(eventFileId: string) {
    return this.db.indexingJob.findFirst({
      where: { targetId: eventFileId, jobType: 'event_roster_indexing', status: 'completed' },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async listParticipants(eventId: string, query: ParticipantsQuery) {
    const where: Prisma.EventParticipantWhereInput = {
      eventId,
      ...(query.studentCode ? { studentCode: query.studentCode } : {}),
      ...(query.className ? { className: query.className } : {}),
      ...(query.faculty ? { faculty: query.faculty } : {}),
      ...(query.q
        ? {
            OR: [
              { studentCode: { contains: query.q, mode: 'insensitive' } },
              { studentName: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const skip = (query.page - 1) * query.limit;

    const [items, total] = await this.db.$transaction([
      this.db.eventParticipant.findMany({
        where,
        orderBy: [{ studentName: 'asc' }, { indexedRow: 'asc' }],
        skip,
        take: query.limit,
      }),
      this.db.eventParticipant.count({ where }),
    ]);

    return { items, total };
  }
}

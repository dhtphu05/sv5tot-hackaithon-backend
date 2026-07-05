import {
  EventStatus,
  EvidenceSourceType,
  Role,
  type EventParticipant,
  type EventRegistry,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { auditActions } from '../../shared/constants/application';
import {
  buildOfficialMatchingStatus,
  getEvidenceStudentStatus,
} from '../../shared/dto/evidence-student-status';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { AuditService } from '../audit/audit.service';
import {
  normalizeMatchingText,
  resolveExactParticipantNameMatch,
} from '../event-registry/event-participant-matching';
import type { EvidenceMatchingSearchQuery } from './evidence-matching.validation';

type EventWithParticipant = EventRegistry & { participants: EventParticipant[] };

export type OfficialMatchType =
  | 'exact_name_and_student_found'
  | 'similar_name_and_student_found'
  | 'exact_name_student_not_found'
  | 'similar_name_student_not_found'
  | 'no_match';

export class EvidenceMatchingService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly auditService = new AuditService(),
  ) {}

  async search(user: AuthenticatedUser, query: EvidenceMatchingSearchQuery) {
    const isStudent = user.role === Role.student || user.role === Role.class_representative;
    const target = await this.resolveSearchTarget(user, query, isStudent);

    if (isStudent && query.studentCode && query.studentCode !== user.studentCode) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Students can only search their own student code');
    }
    if (
      isStudent &&
      query.studentName &&
      normalizeMatchingText(query.studentName) !== normalizeMatchingText(user.fullName)
    ) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Students can only search their own name');
    }

    const normalizedQuery = normalizeMatchingText(query.q ?? '');
    const candidates = await this.findCandidates(query, target);
    const ranked = candidates
      .map((event) => rankEvent(event, normalizedQuery))
      .filter((item) => item.matchType !== 'no_match' || !normalizedQuery)
      .sort((a, b) => b.internalScore - a.internalScore || b.event.updatedAt.getTime() - a.event.updatedAt.getTime())
      .slice((query.page - 1) * query.limit, query.page * query.limit);

    const importedEventIds = query.applicationId
      ? await this.findImportedEventIds(query.applicationId, ranked.map((item) => item.event.id))
      : new Set<string>();

    const items = ranked.map((item) => {
      const participant = item.event.participants[0] ?? null;
      const participantFound = Boolean(participant);
      const similar = item.matchType === 'similar_name_and_student_found' || item.matchType === 'similar_name_student_not_found';
      const studentStatus = participantFound
        ? getEvidenceStudentStatus(similar ? 'similar_name_found' : 'official_match_found')
        : getEvidenceStudentStatus('official_match_not_found');

      return {
        matchType: resolveMatchType(item.matchType, participantFound),
        event: toOfficialMatchingEventDto(item.event),
        participant: participant ? toParticipantDto(participant) : null,
        studentStatus,
        matchingStatus: buildOfficialMatchingStatus({
          found: participantFound,
          similar,
          matchedEventId: item.event.id,
          matchedEventName: item.event.eventName,
          matchedParticipantId: participant?.id ?? null,
        }),
        importable: participantFound,
        alreadyImported: importedEventIds.has(item.event.id),
      };
    });

    if (query.track) {
      await this.auditService.log({
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.OFFICIAL_MATCH_SEARCHED,
        entityType: 'official_matching',
        entityId: user.id,
        metadata: {
          studentCode: target.studentCode ?? null,
          studentName: target.studentName ?? null,
          criterion: query.criterion ?? null,
          query: query.q ?? null,
          statusCode: items.some((item) => item.importable) ? 'official_match_found' : 'official_match_not_found',
          resultCount: items.length,
        },
      });
    }

    return {
      query: query.q ?? '',
      criterion: query.criterion ?? null,
      studentCode: target.studentCode ?? null,
      studentName: target.studentName ?? null,
      items,
      emptyState: {
        studentStatus: getEvidenceStudentStatus('official_match_not_found'),
      },
    };
  }

  private async findCandidates(
    query: EvidenceMatchingSearchQuery,
    target: { studentCode?: string | null; studentName?: string | null },
  ): Promise<EventWithParticipant[]> {
    const where: Prisma.EventRegistryWhereInput = {
      status: EventStatus.active,
      rosterIndexed: true,
      ...(query.criterion ? { criterion: query.criterion } : {}),
    };

    const events = (await this.db.eventRegistry.findMany({
      where,
      include: {
        participants: target.studentName
          ? true
          : {
              where: { studentCode: target.studentCode! },
              take: 1,
            },
      },
      orderBy: { updatedAt: 'desc' },
      take: Math.max(query.limit * 10, 80),
    })) as EventWithParticipant[];

    if (!target.studentName) return events;

    return events.map((event) => {
      const nameMatch = resolveExactParticipantNameMatch(event.participants, target.studentName);
      if (nameMatch.status === 'matched') {
        return { ...event, participants: [nameMatch.participant] };
      }
      if (nameMatch.status === 'duplicate') {
        return { ...event, participants: [] };
      }
      const fallback = target.studentCode
        ? event.participants.find((participant) => participant.studentCode === target.studentCode)
        : undefined;
      return { ...event, participants: fallback ? [fallback] : [] };
    });
  }

  private async resolveSearchTarget(
    user: AuthenticatedUser,
    query: EvidenceMatchingSearchQuery,
    isStudent: boolean,
  ) {
    let studentCode = isStudent ? user.studentCode : query.studentCode;
    let studentName = query.studentName?.trim() || undefined;

    if (query.applicationId && (!studentCode || !studentName)) {
      const application = await this.db.application.findUnique({
        where: { id: query.applicationId },
        select: {
          student: {
            select: { studentCode: true, fullName: true },
          },
        },
      });
      if (!application) {
        throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
      }
      studentCode = studentCode ?? application.student.studentCode;
      studentName = studentName ?? application.student.fullName;
    }

    if (!studentCode && !studentName && isStudent) {
      studentName = user.fullName;
    }
    if (!studentCode && !studentName) {
      throw new AppError(
        400,
        ErrorCodes.VALIDATION_ERROR,
        'studentName or studentCode is required',
      );
    }

    return { studentCode, studentName };
  }

  private async findImportedEventIds(applicationId: string, eventIds: string[]) {
    if (eventIds.length === 0) return new Set<string>();
    const evidences = await this.db.evidence.findMany({
      where: {
        applicationId,
        sourceType: EvidenceSourceType.event_import,
        eventId: { in: eventIds },
      },
      select: { eventId: true },
    });
    return new Set(evidences.map((evidence) => evidence.eventId).filter((id): id is string => Boolean(id)));
  }
}

function rankEvent(
  event: EventWithParticipant,
  normalizedQuery: string,
): { event: EventWithParticipant; internalScore: number; matchType: OfficialMatchType } {
  if (!normalizedQuery) {
    return {
      event,
      internalScore: event.participants.length > 0 ? 1 : 0.5,
      matchType: event.participants.length > 0 ? 'similar_name_and_student_found' : 'similar_name_student_not_found',
    };
  }

  const normalizedName = normalizeMatchingText(event.eventName);
  const normalizedOrganizer = normalizeMatchingText(event.organizer);
  const normalizedDocument = normalizeMatchingText(event.officialDocumentNo ?? '');
  const participantFound = event.participants.length > 0;

  if (normalizedName === normalizedQuery || normalizedDocument === normalizedQuery) {
    return {
      event,
      internalScore: participantFound ? 100 : 80,
      matchType: participantFound ? 'exact_name_and_student_found' : 'exact_name_student_not_found',
    };
  }

  if (normalizedName.includes(normalizedQuery) || normalizedQuery.includes(normalizedName)) {
    return {
      event,
      internalScore: participantFound ? 90 : 70,
      matchType: participantFound ? 'similar_name_and_student_found' : 'similar_name_student_not_found',
    };
  }

  const overlap = tokenOverlap(normalizedQuery, `${normalizedName} ${normalizedOrganizer} ${normalizedDocument}`);
  if (overlap > 0) {
    return {
      event,
      internalScore: overlap + (participantFound ? 20 : 0),
      matchType: participantFound ? 'similar_name_and_student_found' : 'similar_name_student_not_found',
    };
  }

  return {
    event,
    internalScore: 0,
    matchType: 'no_match' as OfficialMatchType,
  };
}

function resolveMatchType(matchType: OfficialMatchType, participantFound: boolean): OfficialMatchType {
  if (matchType === 'exact_name_and_student_found' || matchType === 'exact_name_student_not_found') {
    return participantFound ? 'exact_name_and_student_found' : 'exact_name_student_not_found';
  }
  if (matchType === 'similar_name_and_student_found' || matchType === 'similar_name_student_not_found') {
    return participantFound ? 'similar_name_and_student_found' : 'similar_name_student_not_found';
  }
  return 'no_match';
}

function tokenOverlap(query: string, target: string): number {
  const queryTokens = new Set(query.split(' ').filter((token) => token.length >= 2));
  if (queryTokens.size === 0) return 0;
  const targetTokens = new Set(target.split(' ').filter((token) => token.length >= 2));
  let matches = 0;
  for (const token of queryTokens) {
    if (targetTokens.has(token)) matches += 1;
  }
  return matches / queryTokens.size;
}

function toOfficialMatchingEventDto(event: EventRegistry) {
  return {
    id: event.id,
    eventName: event.eventName,
    name: event.eventName,
    criterion: event.criterion,
    organizer: event.organizer,
    organizerLevel: event.organizerLevel,
    startDate: event.startDate,
    endDate: event.endDate,
    convertedValue: event.convertedValue,
    convertedUnit: event.convertedUnit,
    officialDocumentNo: event.officialDocumentNo,
  };
}

function toParticipantDto(participant: EventParticipant) {
  return {
    id: participant.id,
    studentCode: participant.studentCode,
    studentName: participant.studentName,
    className: participant.className,
    faculty: participant.faculty,
    convertedValue: participant.convertedValue,
  };
}

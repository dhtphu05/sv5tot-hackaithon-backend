import {
  ApprovedEvidencePrecedentStatus,
  EventStatus,
  EvidenceSourceType,
  Role,
  type Application,
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
import { assertSameWorkspace, workspaceFilterFor } from '../../shared/utils/workspace-scope';
import { AuditService } from '../audit/audit.service';
import { assertApplicationOwner } from '../applications/application.helpers';
import {
  normalizeMatchingText,
  resolveExactParticipantNameMatch,
} from '../event-registry/event-participant-matching';
import {
  EVENT_SUGGESTION_MIN_QUERY_LENGTH,
  rankEventSuggestions,
  type EventSuggestionCandidate,
} from './event-suggestion-ranking';
import {
  toStudentOfficialEventLibraryItemDto,
  toStudentReferenceEventLibraryItemDto,
} from './evidence-matching.dto';
import type {
  EvidenceEventSuggestionQuery,
  EvidenceMatchingLibraryQuery,
  EvidenceMatchingSearchQuery,
} from './evidence-matching.validation';

type EventWithParticipant = EventRegistry & { participants: EventParticipant[] };
type StudentLibraryEvent = Pick<
  EventRegistry,
  'id' | 'eventName' | 'organizer' | 'organizerLevel' | 'criterion' | 'updatedAt'
>;

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

  async library(user: AuthenticatedUser, query: EvidenceMatchingLibraryQuery) {
    if (user.role !== Role.student) {
      throw new AppError(
        403,
        ErrorCodes.FORBIDDEN,
        'Only students can browse the official evidence library',
      );
    }

    const application = await this.db.application.findUnique({
      where: { id: query.applicationId },
      select: { id: true, studentId: true, workspaceId: true },
    });
    if (!application) {
      throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
    }

    assertSameWorkspace(user, application, 'Application not found');
    assertApplicationOwner(application as Application, user);

    const search = query.search?.trim();
    const where: Prisma.EventRegistryWhereInput = {
      workspaceId: application.workspaceId,
      status: EventStatus.active,
      ...(query.criterion ? { criterion: query.criterion } : {}),
      ...(query.projection === 'reference'
        ? {
            approvedEvidencePrecedents: {
              some: {
                workspaceId: application.workspaceId,
                status: ApprovedEvidencePrecedentStatus.active,
              },
            },
          }
        : { rosterIndexed: true }),
    };
    const skip = (query.page - 1) * query.limit;

    const select = {
      id: true,
      eventName: true,
      organizer: true,
      organizerLevel: true,
      criterion: true,
      updatedAt: true,
    } satisfies Prisma.EventRegistrySelect;

    const [events, total] = search
      ? await this.searchLibraryEvents(where, search, skip, query.limit)
      : await this.db.$transaction([
          this.db.eventRegistry.findMany({
            where,
            select,
            orderBy: { updatedAt: 'desc' },
            skip,
            take: query.limit,
          }),
          this.db.eventRegistry.count({ where }),
        ]);

    const eventIds = events.map((event) => event.id);
    const importedEventIds =
      query.projection === 'reference'
        ? new Set<string>()
        : await this.findImportedEventIds(application.id, eventIds);
    const approvedUsageCountByEvent =
      query.projection === 'reference'
        ? await this.countApprovedUsageByEvent(eventIds, application.workspaceId)
        : new Map<string, number>();

    return {
      items:
        query.projection === 'reference'
          ? events.map((event) =>
              toStudentReferenceEventLibraryItemDto(
                event,
                approvedUsageCountByEvent.get(event.id) ?? 0,
              ),
            )
          : events.map((event) =>
              toStudentOfficialEventLibraryItemDto(event, importedEventIds.has(event.id)),
            ),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async search(user: AuthenticatedUser, query: EvidenceMatchingSearchQuery) {
    const isStudent = user.role === Role.student || user.role === Role.class_representative;
    const target = await this.resolveSearchTarget(user, query, isStudent);

    if (isStudent && query.studentCode && query.studentCode !== user.studentCode) {
      throw new AppError(
        403,
        ErrorCodes.FORBIDDEN,
        'Students can only search their own student code',
      );
    }
    if (
      isStudent &&
      query.studentName &&
      normalizeMatchingText(query.studentName) !== normalizeMatchingText(user.fullName)
    ) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Students can only search their own name');
    }

    const normalizedQuery = normalizeMatchingText(query.q ?? '');
    const candidates = await this.findCandidates(user, query, target);
    const ranked = candidates
      .map((event) => rankEvent(event, normalizedQuery))
      .filter((item) => item.matchType !== 'no_match' || !normalizedQuery)
      .sort(
        (a, b) =>
          b.internalScore - a.internalScore ||
          b.event.updatedAt.getTime() - a.event.updatedAt.getTime(),
      )
      .slice((query.page - 1) * query.limit, query.page * query.limit);

    const importedEventIds = query.applicationId
      ? await this.findImportedEventIds(
          query.applicationId,
          ranked.map((item) => item.event.id),
        )
      : new Set<string>();

    const items = ranked.map((item) => {
      const participant = item.event.participants[0] ?? null;
      const participantFound = Boolean(participant);
      const similar =
        item.matchType === 'similar_name_and_student_found' ||
        item.matchType === 'similar_name_student_not_found';
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
          statusCode: items.some((item) => item.importable)
            ? 'official_match_found'
            : 'official_match_not_found',
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

  async suggestions(user: AuthenticatedUser, query: EvidenceEventSuggestionQuery) {
    const application = await this.db.application.findUnique({
      where: { id: query.applicationId },
      select: { id: true, studentId: true, workspaceId: true },
    });
    if (!application) {
      throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
    }
    assertSameWorkspace(user, application, 'Application not found');
    assertApplicationOwner(application as Application, user);

    const normalizedQuery = normalizeLibraryText(query.query);
    const hasEventId = Boolean(query.eventId);
    if (!hasEventId && normalizedQuery.length < EVENT_SUGGESTION_MIN_QUERY_LENGTH) {
      return {
        query: query.query ?? null,
        normalizedQuery: normalizedQuery || null,
        suggestions: [],
        meta: {
          minimumQueryLength: EVENT_SUGGESTION_MIN_QUERY_LENGTH,
          resultCount: 0,
          source: 'event_registry' as const,
        },
      };
    }

    const where: Prisma.EventRegistryWhereInput = {
      workspaceId: application.workspaceId,
      status: EventStatus.active,
      rosterIndexed: true,
      ...(query.criterion ? { criterion: query.criterion } : {}),
      ...(query.eventId ? { id: query.eventId } : {}),
    };

    const events = (await this.db.eventRegistry.findMany({
      where,
      select: {
        id: true,
        eventName: true,
        criterion: true,
        organizer: true,
        organizerLevel: true,
        startDate: true,
        endDate: true,
        convertedValue: true,
        convertedUnit: true,
        createdAt: true,
        updatedAt: true,
        aliases: { select: { alias: true, normalizedAliasKey: true } },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: query.eventId ? 1 : Math.max(query.limit * 25, 250),
    })) as EventSuggestionCandidate[];

    const importedEventIds = await this.findImportedEventIds(
      application.id,
      events.map((event) => event.id),
    );
    const visibleEvents = query.excludeImported
      ? events.filter((event) => !importedEventIds.has(event.id))
      : events;
    const ranked = rankEventSuggestions({
      events: visibleEvents,
      query: query.eventId ? (query.query ?? null) : normalizedQuery,
      criterion: query.criterion,
    }).slice(0, query.limit);

    await this.auditService.log({
      actorId: user.id,
      actorRole: user.role,
      action: auditActions.EVENT_SUGGESTION_VIEWED,
      entityType: 'official_matching',
      entityId: application.id,
      applicationId: application.id,
      metadata: {
        criterion: query.criterion ?? null,
        query: query.query ?? null,
        eventId: query.eventId ?? null,
        resultCount: ranked.length,
      },
    });

    return {
      query: query.query ?? null,
      normalizedQuery: normalizedQuery || null,
      suggestions: ranked.map((item) => ({
        eventId: item.event.id,
        eventName: item.event.eventName,
        criterion: item.event.criterion,
        organizer: item.event.organizer,
        organizerLevel: item.event.organizerLevel,
        startDate: item.event.startDate,
        endDate: item.event.endDate,
        convertedValue: item.event.convertedValue,
        convertedUnit: item.event.convertedUnit,
        alreadyImported: importedEventIds.has(item.event.id),
        match: item.match,
        participantCheck: {
          required: true,
          state: 'eligible_to_check' as const,
        },
      })),
      meta: {
        minimumQueryLength: EVENT_SUGGESTION_MIN_QUERY_LENGTH,
        resultCount: ranked.length,
        source: 'event_registry' as const,
      },
    };
  }

  private async findCandidates(
    user: AuthenticatedUser,
    query: EvidenceMatchingSearchQuery,
    target: { studentCode?: string | null; studentName?: string | null },
  ): Promise<EventWithParticipant[]> {
    const where: Prisma.EventRegistryWhereInput = {
      ...workspaceFilterFor(user),
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
          workspaceId: true,
          student: {
            select: { studentCode: true, fullName: true },
          },
        },
      });
      if (!application) {
        throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
      }
      assertSameWorkspace(user, application, 'Application not found');
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
    return new Set(
      evidences.map((evidence) => evidence.eventId).filter((id): id is string => Boolean(id)),
    );
  }

  private async searchLibraryEvents(
    where: Prisma.EventRegistryWhereInput,
    search: string,
    skip: number,
    take: number,
  ): Promise<[StudentLibraryEvent[], number]> {
    const candidates = (await this.db.eventRegistry.findMany({
      where,
      select: {
        id: true,
        eventName: true,
        organizer: true,
        organizerLevel: true,
        criterion: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: Math.max(take * 20, 500),
    })) as StudentLibraryEvent[];

    const ranked = rankLibraryEvents(candidates, search);
    return [ranked.slice(skip, skip + take), ranked.length];
  }

  private async countApprovedUsageByEvent(
    eventIds: string[],
    workspaceId: string,
  ): Promise<Map<string, number>> {
    if (!eventIds.length) return new Map();
    if (!this.db.approvedEvidencePrecedent) return new Map();

    try {
      const precedents = await this.db.approvedEvidencePrecedent.findMany({
        where: {
          workspaceId,
          eventId: { in: eventIds },
          status: ApprovedEvidencePrecedentStatus.active,
        },
        select: {
          eventId: true,
          sourceEvidence: {
            select: {
              applicationId: true,
              application: {
                select: {
                  studentId: true,
                },
              },
            },
          },
        },
      });
      const usageKeysByEvent = new Map<string, Set<string>>();
      for (const precedent of precedents) {
        const usageKey =
          precedent.sourceEvidence.application?.studentId ??
          precedent.sourceEvidence.applicationId ??
          null;
        if (!usageKey) continue;
        const usageKeys = usageKeysByEvent.get(precedent.eventId) ?? new Set<string>();
        usageKeys.add(usageKey);
        usageKeysByEvent.set(precedent.eventId, usageKeys);
      }
      return new Map(
        Array.from(usageKeysByEvent.entries()).map(([eventId, usageKeys]) => [
          eventId,
          usageKeys.size,
        ]),
      );
    } catch (error) {
      if (isEvidenceKnowledgeSchemaMissingError(error)) return new Map();
      throw error;
    }
  }
}

function isEvidenceKnowledgeSchemaMissingError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybeError = error as { code?: unknown; message?: unknown; meta?: unknown };
  if (maybeError.code !== 'P2021') return false;
  const detail = [
    typeof maybeError.message === 'string' ? maybeError.message : '',
    JSON.stringify(maybeError.meta ?? {}),
  ].join(' ');
  return detail.includes('ApprovedEvidencePrecedent');
}

const verifiedLibraryAbbreviations: Record<string, string> = {
  cd: 'chien dich',
  mhx: 'mua he xanh',
  nckh: 'nghien cuu khoa hoc',
};

const verifiedLibraryAliases = new Map<string, string>([
  ['cd mhx', 'chien dich mua he xanh'],
  ['chien dich mhx', 'chien dich mua he xanh'],
  ['mhx', 'mua he xanh'],
  ['nckh', 'nghien cuu khoa hoc'],
  ['hien mau', 'hien mau nhan dao'],
]);

function rankLibraryEvents(events: StudentLibraryEvent[], search: string): StudentLibraryEvent[] {
  const query = normalizeLibraryText(search);
  if (!query) return dedupeLibraryEvents(events);

  const queryVariants = buildLibraryQueryVariants(query);
  const ranked = events
    .map((event) => ({ event, score: scoreLibraryEvent(event, queryVariants) }))
    .filter((item) => item.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.event.updatedAt.getTime() - left.event.updatedAt.getTime(),
    );

  return dedupeLibraryEvents(ranked.map((item) => item.event));
}

function dedupeLibraryEvents(events: StudentLibraryEvent[]): StudentLibraryEvent[] {
  const seen = new Set<string>();
  const deduped: StudentLibraryEvent[] = [];
  for (const event of events) {
    const key = `${event.criterion}:${normalizeLibraryText(event.eventName)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(event);
  }
  return deduped;
}

function buildLibraryQueryVariants(query: string): string[] {
  const expandedTokens = query
    .split(' ')
    .flatMap((token) => verifiedLibraryAbbreviations[token]?.split(' ') ?? [token])
    .join(' ');
  return Array.from(
    new Set(
      [
        query,
        expandedTokens,
        verifiedLibraryAliases.get(query) ?? '',
        ...(query.startsWith('chien dich ') ? [query.replace(/^chien dich\s+/, '')] : []),
      ].filter(Boolean),
    ),
  );
}

function scoreLibraryEvent(event: StudentLibraryEvent, queryVariants: string[]): number {
  const title = normalizeLibraryText(event.eventName);
  const titleVariants = buildLibraryEventTitleVariants(title);
  const organizer = normalizeLibraryText(event.organizer);
  const eventAcronyms = titleVariants.map((variant) => buildAcronym(variant)).filter(Boolean);
  const searchable = `${titleVariants.join(' ')} ${organizer}`;

  let best = 0;
  for (const query of queryVariants) {
    const queryAcronym = buildAcronym(query);
    if (titleVariants.some((variant) => variant === query)) best = Math.max(best, 100);
    if (titleVariants.some((variant) => variant.includes(query) || query.includes(variant))) {
      best = Math.max(best, 90);
    }
    if (eventAcronyms.some((acronym) => acronym === query || acronym === queryAcronym)) {
      best = Math.max(best, 85);
    }
    if (
      eventAcronyms.some((acronym) => query.includes(acronym)) &&
      titleVariants.some((variant) => tokenOverlap(query, variant) > 0)
    ) {
      best = Math.max(best, 80);
    }
    const overlap = tokenOverlap(query, searchable);
    if (overlap >= 0.5 && titleVariants.some((variant) => hasNonYearTokenOverlap(query, variant))) {
      best = Math.max(best, 50 + overlap);
    }
    if (
      titleVariants.some(
        (variant) => hasNonYearTokenOverlap(query, variant) && isFuzzyLibraryMatch(query, variant),
      )
    ) {
      best = Math.max(best, 35);
    }
  }

  return best;
}

function buildLibraryEventTitleVariants(title: string): string[] {
  const variants = new Set([title]);
  if (title.includes('tinh nguyen he')) {
    variants.add(title.replace(/.*?\btinh nguyen he\b/, 'mua he xanh'));
    variants.add(title.replace(/.*?\btinh nguyen he\b/, 'chien dich mua he xanh'));
  }
  if (title.includes('mua he xanh')) {
    variants.add(title.replace(/\bmua he xanh\b/, 'tinh nguyen he'));
    variants.add(title.replace(/\bmua he xanh\b/, 'chien dich mua he xanh'));
  }
  return Array.from(variants);
}

function normalizeLibraryText(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/đ/g, 'd')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildAcronym(value: string): string {
  const tokens = value.split(' ').filter((token) => token && !/^\d{4}$/.test(token));
  return tokens.map((token) => token[0]).join('');
}

function isFuzzyLibraryMatch(query: string, title: string): boolean {
  const queryTokens = query.split(' ').filter((token) => token.length >= 3);
  const titleTokens = title.split(' ').filter((token) => token.length >= 3);
  return queryTokens.every((queryToken) =>
    titleTokens.some((titleToken) => {
      if (titleToken.includes(queryToken) || queryToken.includes(titleToken)) return true;
      const distance = levenshteinDistance(queryToken, titleToken);
      return (
        distance <= Math.max(2, Math.floor(Math.min(queryToken.length, titleToken.length) / 4))
      );
    }),
  );
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length] ?? 0;
}

function rankEvent(
  event: EventWithParticipant,
  normalizedQuery: string,
): { event: EventWithParticipant; internalScore: number; matchType: OfficialMatchType } {
  if (!normalizedQuery) {
    return {
      event,
      internalScore: event.participants.length > 0 ? 1 : 0.5,
      matchType:
        event.participants.length > 0
          ? 'similar_name_and_student_found'
          : 'similar_name_student_not_found',
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
      matchType: participantFound
        ? 'similar_name_and_student_found'
        : 'similar_name_student_not_found',
    };
  }

  const overlap = tokenOverlap(
    normalizedQuery,
    `${normalizedName} ${normalizedOrganizer} ${normalizedDocument}`,
  );
  if (overlap > 0) {
    return {
      event,
      internalScore: overlap + (participantFound ? 20 : 0),
      matchType: participantFound
        ? 'similar_name_and_student_found'
        : 'similar_name_student_not_found',
    };
  }

  return {
    event,
    internalScore: 0,
    matchType: 'no_match' as OfficialMatchType,
  };
}

function resolveMatchType(
  matchType: OfficialMatchType,
  participantFound: boolean,
): OfficialMatchType {
  if (
    matchType === 'exact_name_and_student_found' ||
    matchType === 'exact_name_student_not_found'
  ) {
    return participantFound ? 'exact_name_and_student_found' : 'exact_name_student_not_found';
  }
  if (
    matchType === 'similar_name_and_student_found' ||
    matchType === 'similar_name_student_not_found'
  ) {
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

function hasNonYearTokenOverlap(query: string, target: string): boolean {
  const targetTokens = new Set(
    target.split(' ').filter((token) => token.length >= 2 && !/^\d{4}$/.test(token)),
  );
  return query
    .split(' ')
    .filter((token) => token.length >= 2 && !/^\d{4}$/.test(token))
    .some((token) => targetTokens.has(token));
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

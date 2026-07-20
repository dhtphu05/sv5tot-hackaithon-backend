import { Role, type Criterion, type Prisma } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { assertSameWorkspace } from '../../shared/utils/workspace-scope';
import {
  aliasTexts,
  type EvidenceKnowledgeMatchReason,
  type OfficerEvidenceKnowledgeSearchResponseDto,
  type ScoredPrecedentGroup,
  toOfficerEvidenceKnowledgeEventDetailDto,
} from './evidence-knowledge.dto';
import {
  type ApprovedPrecedentSearchRecord,
  EvidenceKnowledgeRepository,
} from './evidence-knowledge.repository';
import type {
  EvidenceKnowledgeOfficerSearchQuery,
  ReviewTaskPrecedentCheckQuery,
} from './evidence-knowledge.validation';
import {
  assertCanAccessEvidenceKnowledgeCriterion,
  resolveEvidenceKnowledgeScope,
} from './evidence-knowledge.permissions';
import {
  buildAcronym,
  extractYear,
  hasNonYearTokenOverlap,
  isFuzzyEvidenceKnowledgeMatch,
  normalizeEvidenceKnowledgeText,
  tokenOverlap,
} from './evidence-knowledge.normalizer';

type ReviewTaskForPrecedentSearch = {
  id: string;
  workspaceId: string;
  criterion: Criterion;
  applicationId: string | null;
  application: { workspaceId: string; targetLevel: string; schoolYear: string } | null;
  evidences: Array<{
    evidence: {
      id: string;
      evidenceName: string;
      eventId: string | null;
      event: { eventName: string; organizer: string | null; startDate: Date | null } | null;
      evidenceCard: {
        ocrText: string | null;
        extractedFieldsJson: Prisma.JsonValue | null;
        normalizedFieldsJson: Prisma.JsonValue | null;
      } | null;
    };
  }>;
};

export class EvidenceKnowledgeService {
  constructor(
    private readonly repository = new EvidenceKnowledgeRepository(),
    private readonly db: typeof prisma = prisma,
  ) {}

  async searchOfficer(
    user: AuthenticatedUser,
    query: EvidenceKnowledgeOfficerSearchQuery,
  ): Promise<OfficerEvidenceKnowledgeSearchResponseDto> {
    const scope = await resolveEvidenceKnowledgeScope(user, query.criterion, this.db);
    if (query.applicationId) {
      const application = await this.db.application.findUnique({
        where: { id: query.applicationId },
        select: { workspaceId: true },
      });
      if (!application) {
        throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
      }
      assertSameWorkspace(user, application, 'Application not found');
    }

    const records = await this.repository.searchPrecedents({
      workspaceId: scope.workspaceId,
      criteria: scope.criteria,
      year: query.year,
      level: query.level,
      limit: query.limit,
    });
    const abbreviations = await this.repository.listWorkspaceAbbreviations(scope.workspaceId);
    const ranked = rankPrecedentGroups(records, query.q ?? '', abbreviations);
    const skip = (query.page - 1) * query.limit;
    const items = ranked
      .slice(skip, skip + query.limit)
      .map(({ score: _score, records: _records, ...item }) => item);

    return {
      items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total: ranked.length,
        totalPages: Math.ceil(ranked.length / query.limit),
      },
    };
  }

  async getOfficerEvent(user: AuthenticatedUser, eventId: string) {
    const event = await this.db.eventRegistry.findUnique({
      where: { id: eventId },
      select: { id: true, workspaceId: true, criterion: true },
    });
    if (!event) {
      throw new AppError(404, ErrorCodes.EVENT_NOT_FOUND, 'Approved event not found');
    }
    await assertCanAccessEvidenceKnowledgeCriterion(
      user,
      event.criterion,
      event.workspaceId,
      this.db,
    );

    const records = await this.repository.getEventDetail({
      eventId,
      workspaceId: user.role === Role.admin ? undefined : event.workspaceId,
    });
    if (!records.length) {
      throw new AppError(404, ErrorCodes.EVENT_NOT_FOUND, 'Approved event not found');
    }
    return toOfficerEvidenceKnowledgeEventDetailDto(eventId, records);
  }

  async assertPrecedentUsableByOfficer(
    user: AuthenticatedUser,
    input: { precedentId?: string; precedentEventId?: string; precedentEvidenceId?: string },
    criterion: Criterion,
  ) {
    if (!input.precedentId && !input.precedentEventId && !input.precedentEvidenceId) return null;

    const precedent = input.precedentId
      ? await this.repository.getPrecedentById(input.precedentId)
      : await this.repository.findPrecedentReference({
          eventId: input.precedentEventId,
          evidenceId: input.precedentEvidenceId,
        });
    if (!precedent || precedent.criterion !== criterion) {
      throw new AppError(404, ErrorCodes.EVENT_NOT_FOUND, 'Approved precedent not found');
    }
    await assertCanAccessEvidenceKnowledgeCriterion(
      user,
      precedent.criterion,
      precedent.workspaceId,
      this.db,
    );
    return {
      precedentId: precedent.id,
      precedentEventId: precedent.eventId,
      precedentEvidenceId: precedent.sourceEvidenceId,
    };
  }

  async searchForReviewTask(
    user: AuthenticatedUser,
    task: ReviewTaskForPrecedentSearch,
    query: ReviewTaskPrecedentCheckQuery,
  ) {
    await assertCanAccessEvidenceKnowledgeCriterion(
      user,
      task.criterion,
      task.workspaceId,
      this.db,
    );
    const searchText = buildReviewTaskSearchText(task);
    const result = await this.searchOfficer(user, {
      q: searchText,
      criterion: task.criterion,
      applicationId: task.applicationId ?? undefined,
      page: 1,
      limit: query.limit,
    });
    return {
      items: result.items,
      hasStrongPrecedent: result.items.length > 0,
    };
  }
}

function rankPrecedentGroups(
  records: ApprovedPrecedentSearchRecord[],
  rawQuery: string,
  abbreviations: Array<{ normalizedTokenKey: string; normalizedExpandedKey: string }>,
): ScoredPrecedentGroup[] {
  const query = normalizeEvidenceKnowledgeText(rawQuery);
  const groups = new Map<string, ApprovedPrecedentSearchRecord[]>();
  for (const record of records) {
    const group = groups.get(record.eventId) ?? [];
    group.push(record);
    groups.set(record.eventId, group);
  }

  return Array.from(groups.values())
    .map((group) => scoreGroup(group, query, abbreviations))
    .filter((group) => !query || group.score > 0)
    .sort((left, right) => right.score - left.score || right.acceptedCount - left.acceptedCount);
}

function scoreGroup(
  records: ApprovedPrecedentSearchRecord[],
  query: string,
  abbreviations: Array<{ normalizedTokenKey: string; normalizedExpandedKey: string }>,
): ScoredPrecedentGroup {
  const first = records[0];
  const aliases = aliasTexts(first.event.aliases);
  const variants = buildQueryVariants(query, abbreviations);
  const matchReasons = new Set<EvidenceKnowledgeMatchReason>();
  let score = query ? 0 : 1;

  for (const variant of variants) {
    const canonical = normalizeEvidenceKnowledgeText(first.event.eventName);
    const canonicalAcronym = buildAcronym(canonical);
    if (variant && canonical === variant) {
      score = Math.max(score, 100);
      matchReasons.add('canonical_title');
    }
    if (variant && (canonical.includes(variant) || variant.includes(canonical))) {
      score = Math.max(score, 90);
      matchReasons.add('canonical_title');
    }
    for (const alias of aliases) {
      const normalizedAlias = normalizeEvidenceKnowledgeText(alias);
      if (variant && (normalizedAlias === variant || normalizedAlias.includes(variant))) {
        score = Math.max(score, 88);
        matchReasons.add('verified_alias');
      }
      if (buildAcronym(normalizedAlias) === variant) {
        score = Math.max(score, 84);
        matchReasons.add('acronym');
      }
    }
    if (canonicalAcronym && (canonicalAcronym === variant || variant.includes(canonicalAcronym))) {
      score = Math.max(score, 82);
      matchReasons.add('acronym');
    }

    for (const record of records) {
      const organizer = normalizeEvidenceKnowledgeText(record.organizer ?? first.event.organizer);
      const year = record.eventYear ? String(record.eventYear) : '';
      const businessText = `${canonical} ${organizer} ${year}`;
      const overlap = tokenOverlap(variant, businessText);
      if (overlap >= 0.5 && hasNonYearTokenOverlap(variant, businessText)) {
        score = Math.max(score, 55 + overlap);
        if (organizer && tokenOverlap(variant, organizer) > 0) matchReasons.add('organizer');
        if (year && variant.includes(year)) matchReasons.add('year');
      }
      if (record.ocrSearchKey && variant && record.ocrSearchKey.includes(variant)) {
        score = Math.max(score, 45);
        matchReasons.add('ocr');
      }
      if (
        hasNonYearTokenOverlap(variant, canonical) &&
        isFuzzyEvidenceKnowledgeMatch(variant, canonical)
      ) {
        score = Math.max(score, 35);
        matchReasons.add('typo');
      }
    }
  }

  return {
    eventId: first.eventId,
    canonicalTitle: first.event.eventName,
    aliases,
    criterion: first.criterion,
    organizer: first.organizer ?? first.event.organizer,
    year: first.eventYear,
    applicableLevel: first.applicableLevel,
    acceptedCount: records.length,
    approvalSources: Array.from(new Set(records.map((record) => record.approvalSource))),
    hasResolutionPrecedent: records.some(
      (record) => record.approvalSource === 'resolution' || Boolean(record.sourceResolutionCaseId),
    ),
    matchReasons: Array.from(matchReasons),
    score,
    records,
  };
}

function buildQueryVariants(
  query: string,
  abbreviations: Array<{ normalizedTokenKey: string; normalizedExpandedKey: string }>,
): string[] {
  if (!query) return [''];
  const abbreviationMap = new Map([
    ['mhx', 'mua he xanh'],
    ['cd mhx', 'chien dich mua he xanh'],
    ['nckh', 'nghien cuu khoa hoc'],
    ['hien mau', 'hien mau nhan dao'],
    ...abbreviations.map((item) => [item.normalizedTokenKey, item.normalizedExpandedKey] as const),
  ]);
  const expandedTokens = query
    .split(' ')
    .flatMap((token) => abbreviationMap.get(token)?.split(' ') ?? [token])
    .join(' ');
  return Array.from(
    new Set(
      [
        query,
        expandedTokens,
        abbreviationMap.get(query) ?? '',
        ...(query.startsWith('chien dich ') ? [query.replace(/^chien dich\s+/, '')] : []),
      ].filter(Boolean),
    ),
  );
}

function buildReviewTaskSearchText(task: ReviewTaskForPrecedentSearch): string {
  const pieces: string[] = [];
  for (const link of task.evidences) {
    pieces.push(link.evidence.evidenceName);
    if (link.evidence.event?.eventName) pieces.push(link.evidence.event.eventName);
    if (link.evidence.event?.organizer) pieces.push(link.evidence.event.organizer);
    const eventYear = extractYear(link.evidence.event?.startDate ?? link.evidence.evidenceName);
    if (eventYear) pieces.push(String(eventYear));
    const fields =
      link.evidence.evidenceCard?.normalizedFieldsJson ??
      link.evidence.evidenceCard?.extractedFieldsJson;
    const fieldText = flattenJsonText(fields);
    if (fieldText) pieces.push(fieldText);
  }
  if (task.application?.schoolYear) pieces.push(task.application.schoolYear);
  return pieces.join(' ');
}

function flattenJsonText(value: Prisma.JsonValue | null | undefined): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(flattenJsonText).join(' ');
  if (typeof value === 'object') return Object.values(value).map(flattenJsonText).join(' ');
  return '';
}

import type { Criterion, EventRegistry, EventRegistryAlias } from '@prisma/client';

export const EVENT_SUGGESTION_MIN_QUERY_LENGTH = 3;

export type EventSuggestionCandidate = Pick<
  EventRegistry,
  | 'id'
  | 'eventName'
  | 'criterion'
  | 'organizer'
  | 'organizerLevel'
  | 'startDate'
  | 'endDate'
  | 'convertedValue'
  | 'convertedUnit'
  | 'createdAt'
  | 'updatedAt'
> & {
  aliases?: Array<Pick<EventRegistryAlias, 'alias' | 'normalizedAliasKey'>>;
};

export type EventSuggestionMatch = {
  score: number;
  level: 'exact' | 'strong' | 'possible';
  reasons: string[];
};

export type RankedEventSuggestion = {
  event: EventSuggestionCandidate;
  match: EventSuggestionMatch;
};

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

export function rankEventSuggestions(input: {
  events: EventSuggestionCandidate[];
  query?: string | null;
  criterion?: Criterion;
  now?: Date;
}): RankedEventSuggestion[] {
  const normalizedQuery = normalizeLibraryText(input.query);
  if (!normalizedQuery) {
    return input.events
      .map((event) => ({
        event,
        match: {
          score: baseEventScore(event, input.criterion, input.now),
          level: 'possible' as const,
          reasons: ['criterion_match'],
        },
      }))
      .sort(compareRankedSuggestions);
  }

  const queryVariants = buildLibraryQueryVariants(normalizedQuery);
  return input.events
    .map((event) => ({
      event,
      match: scoreEventSuggestion(event, queryVariants, input.criterion, input.now),
    }))
    .filter((item) => item.match.score > 0)
    .sort(compareRankedSuggestions);
}

export function normalizeLibraryText(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/đ/g, 'd')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildLibraryQueryVariants(query: string): string[] {
  const expandedTokens = query
    .split(' ')
    .flatMap((token) => verifiedLibraryAbbreviations[token]?.split(' ') ?? [token])
    .join(' ');
  return Array.from(
    new Set([
      query,
      expandedTokens,
      verifiedLibraryAliases.get(query) ?? '',
      ...(query.startsWith('chien dich ') ? [query.replace(/^chien dich\s+/, '')] : []),
    ].filter(Boolean)),
  );
}

export function tokenOverlap(query: string, target: string): number {
  const queryTokens = new Set(query.split(' ').filter((token) => token.length >= 2));
  if (queryTokens.size === 0) return 0;
  const targetTokens = new Set(target.split(' ').filter((token) => token.length >= 2));
  let matches = 0;
  for (const token of queryTokens) {
    if (targetTokens.has(token)) matches += 1;
  }
  return matches / queryTokens.size;
}

export function hasNonYearTokenOverlap(query: string, target: string): boolean {
  const targetTokens = new Set(
    target
      .split(' ')
      .filter((token) => token.length >= 2 && !/^\d{4}$/.test(token)),
  );
  return query
    .split(' ')
    .filter((token) => token.length >= 2 && !/^\d{4}$/.test(token))
    .some((token) => targetTokens.has(token));
}

export function buildAcronym(value: string): string {
  const tokens = value.split(' ').filter((token) => token && !/^\d{4}$/.test(token));
  return tokens.map((token) => token[0]).join('');
}

export function isFuzzyLibraryMatch(query: string, title: string): boolean {
  const queryTokens = query.split(' ').filter((token) => token.length >= 3);
  const titleTokens = title.split(' ').filter((token) => token.length >= 3);
  return queryTokens.every((queryToken) =>
    titleTokens.some((titleToken) => {
      if (titleToken.includes(queryToken) || queryToken.includes(titleToken)) return true;
      const distance = levenshteinDistance(queryToken, titleToken);
      return distance <= Math.max(2, Math.floor(Math.min(queryToken.length, titleToken.length) / 4));
    }),
  );
}

function scoreEventSuggestion(
  event: EventSuggestionCandidate,
  queryVariants: string[],
  criterion?: Criterion,
  now?: Date,
): EventSuggestionMatch {
  const title = normalizeLibraryText(event.eventName);
  const organizer = normalizeLibraryText(event.organizer);
  const eventAcronym = buildAcronym(title);
  const aliases = event.aliases ?? [];
  const normalizedAliases = aliases.map((alias) => normalizeLibraryText(alias.normalizedAliasKey || alias.alias));
  const searchable = `${title} ${organizer}`;

  let best = 0;
  const reasons = new Set<string>();
  for (const query of queryVariants) {
    const queryAcronym = buildAcronym(query);
    if (title === query) {
      best = Math.max(best, 100);
      reasons.add('exact_normalized_name');
    }
    if (normalizedAliases.some((alias) => alias === query)) {
      best = Math.max(best, 98);
      reasons.add('exact_alias');
    }
    if (title.startsWith(query) || normalizedAliases.some((alias) => alias.startsWith(query))) {
      best = Math.max(best, 88);
      reasons.add('prefix_match');
    }
    if (title.includes(query) || query.includes(title)) {
      best = Math.max(best, 84);
      reasons.add('token_overlap');
    }
    if (eventAcronym && (eventAcronym === query || eventAcronym === queryAcronym)) {
      best = Math.max(best, 82);
      reasons.add('alias_match');
    }
    const overlap = tokenOverlap(query, searchable);
    if (overlap >= 0.5 && hasNonYearTokenOverlap(query, title)) {
      best = Math.max(best, 50 + overlap * 20);
      reasons.add('token_overlap');
    }
    if (hasNonYearTokenOverlap(query, title) && isFuzzyLibraryMatch(query, title)) {
      best = Math.max(best, 38);
      reasons.add('fuzzy_match');
    }
  }

  if (best <= 0) return { score: 0, level: 'possible', reasons: [] };

  const boosted = best + baseEventScore(event, criterion, now);
  if (criterion && event.criterion === criterion) reasons.add('criterion_match');
  if (event.organizer) reasons.add('organizer_match');
  if (event.startDate || event.endDate) reasons.add('event_date_match');

  return {
    score: Number(boosted.toFixed(3)),
    level: boosted >= 95 ? 'exact' : boosted >= 70 ? 'strong' : 'possible',
    reasons: Array.from(reasons),
  };
}

function baseEventScore(
  event: Pick<EventSuggestionCandidate, 'criterion' | 'createdAt' | 'updatedAt'>,
  criterion?: Criterion,
  now = new Date(),
) {
  let score = criterion && event.criterion === criterion ? 5 : 0;
  const referenceDate = event.updatedAt ?? event.createdAt;
  const ageDays = Math.max(0, (now.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24));
  score += Math.max(0, 2 - ageDays / 365);
  return score;
}

function compareRankedSuggestions(left: RankedEventSuggestion, right: RankedEventSuggestion) {
  return (
    right.match.score - left.match.score ||
    right.event.createdAt.getTime() - left.event.createdAt.getTime() ||
    left.event.id.localeCompare(right.event.id)
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

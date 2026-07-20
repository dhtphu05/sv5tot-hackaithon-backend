export function normalizeEvidenceKnowledgeText(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/đ/g, 'd')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildAcronym(value: string): string {
  return normalizeEvidenceKnowledgeText(value)
    .split(' ')
    .filter((token) => token && !/^\d{4}$/.test(token))
    .map((token) => token[0])
    .join('');
}

export function extractYear(value: string | Date | null | undefined): number | null {
  if (value instanceof Date) return value.getFullYear();
  const match = normalizeEvidenceKnowledgeText(value).match(/\b(20\d{2}|19\d{2})\b/);
  return match ? Number(match[1]) : null;
}

export function tokenOverlap(query: string, target: string): number {
  const queryTokens = normalizeEvidenceKnowledgeText(query).split(' ').filter(Boolean);
  if (!queryTokens.length) return 0;
  const targetTokens = new Set(normalizeEvidenceKnowledgeText(target).split(' ').filter(Boolean));
  const hits = queryTokens.filter((token) => targetTokens.has(token)).length;
  return hits / queryTokens.length;
}

export function hasNonYearTokenOverlap(query: string, target: string): boolean {
  const targetTokens = new Set(
    normalizeEvidenceKnowledgeText(target)
      .split(' ')
      .filter((token) => token.length >= 2 && !/^\d{4}$/.test(token)),
  );
  return normalizeEvidenceKnowledgeText(query)
    .split(' ')
    .filter((token) => token.length >= 2 && !/^\d{4}$/.test(token))
    .some((token) => targetTokens.has(token));
}

export function levenshteinDistance(left: string, right: string): number {
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

export function isFuzzyEvidenceKnowledgeMatch(query: string, target: string): boolean {
  const queryTokens = normalizeEvidenceKnowledgeText(query)
    .split(' ')
    .filter((token) => token.length >= 3 && !/^\d{4}$/.test(token));
  const targetTokens = normalizeEvidenceKnowledgeText(target)
    .split(' ')
    .filter((token) => token.length >= 3 && !/^\d{4}$/.test(token));
  if (!queryTokens.length || !targetTokens.length) return false;
  return queryTokens.every((queryToken) =>
    targetTokens.some((targetToken) => {
      if (targetToken.includes(queryToken) || queryToken.includes(targetToken)) return true;
      const distance = levenshteinDistance(queryToken, targetToken);
      return (
        distance <= Math.max(2, Math.floor(Math.min(queryToken.length, targetToken.length) / 4))
      );
    }),
  );
}

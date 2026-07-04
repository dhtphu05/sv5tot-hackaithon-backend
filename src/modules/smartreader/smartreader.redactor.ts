const SECRET_KEYS = new Set([
  'authorization',
  'access_token',
  'accesstoken',
  'vnptaccesstoken',
  'vnpt_access_token',
  'token-id',
  'token_id',
  'tokenid',
  'vnpttokenid',
  'vnpt_token_id',
  'token-key',
  'token_key',
  'tokenkey',
  'vnpttokenkey',
  'vnpt_token_key',
]);

const LARGE_SENSITIVE_KEYS = new Set(['database64', 'datasign']);
const URL_KEYS = new Set(['link', 'resultlink', 'url']);
const LARGE_VALUE_LIMIT = 256;

export function redactSmartReaderSecrets<T>(value: T): T {
  return redactValue(value) as T;
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => {
      const normalizedKey = normalizeKey(key);
      if (SECRET_KEYS.has(normalizedKey)) {
        return [key, '[REDACTED]'];
      }
      if (
        LARGE_SENSITIVE_KEYS.has(normalizedKey) &&
        typeof nestedValue === 'string' &&
        nestedValue.length > LARGE_VALUE_LIMIT
      ) {
        return [key, `[REDACTED_${nestedValue.length}_CHARS]`];
      }
      if (URL_KEYS.has(normalizedKey) && typeof nestedValue === 'string') {
        return [key, redactSignedUrl(nestedValue)];
      }
      return [key, redactValue(nestedValue)];
    }),
  );
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[\s_-]+/g, '');
}

function redactSignedUrl(value: string): string {
  try {
    const url = new URL(value);
    if (
      url.searchParams.has('X-Amz-Signature') ||
      url.searchParams.has('X-Amz-Credential') ||
      url.searchParams.has('Signature')
    ) {
      return `${url.origin}${url.pathname}?[REDACTED_SIGNED_QUERY]`;
    }
  } catch {
    return value;
  }

  return value;
}

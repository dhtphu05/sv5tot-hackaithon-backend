const secretKeyPattern = /(authorization|access[_-]?token|token[_-]?id|token[_-]?key|password|secret|phone|email|student[_-]?code|file[_-]?url|ocr)/i;

export function redactSmartbotSecrets<T>(value: T): T {
  return redactValue(value) as T;
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      secretKeyPattern.test(key) ? '[REDACTED]' : redactValue(item),
    ]),
  );
}

export function safePreview(text: string, maxLength = 200): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

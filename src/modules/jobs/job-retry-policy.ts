import { JobStatus } from '@prisma/client';

export function getJobFailureTransition(input: {
  retryable: boolean;
  attempts: number;
  maxAttempts: number;
}) {
  const retryable = input.retryable && input.attempts < input.maxAttempts;
  return {
    status: retryable ? JobStatus.queued : JobStatus.failed,
    retryable,
  };
}

export function getJobRetryDelayMs(attempts: number, baseDelayMs: number, maxDelayMs: number) {
  return Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempts - 1));
}

export function isJobFailureRetryable(resultJson: unknown) {
  if (!resultJson || typeof resultJson !== 'object' || Array.isArray(resultJson)) return true;
  return (resultJson as Record<string, unknown>).retryable !== false;
}

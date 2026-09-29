import { env } from '../../config/env';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';

export async function downloadStoredObject(
  signedUrl: string,
  failureMessage = 'Stored document download failed',
): Promise<Buffer> {
  try {
    const response = await fetch(signedUrl, {
      signal: AbortSignal.timeout(env.JOB_WORKER_STORAGE_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new AppError(502, ErrorCodes.STORAGE_ERROR, failureMessage, {
        retryable: true,
        status: response.status,
      });
    }
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof AppError) throw error;
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new AppError(
      timedOut ? 504 : 502,
      ErrorCodes.STORAGE_ERROR,
      failureMessage,
      { retryable: true },
    );
  }
}

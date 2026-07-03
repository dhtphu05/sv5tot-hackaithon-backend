import type { ErrorRequestHandler } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../shared/errors/app-error';
import { ErrorCodes } from '../shared/errors/error-codes';
import { sendError } from '../shared/responses/api-response';

function isJsonParseError(error: unknown): error is SyntaxError & { status: number; type: string } {
  return (
    error instanceof SyntaxError &&
    typeof (error as { status?: unknown }).status === 'number' &&
    (error as { status?: unknown }).status === 400 &&
    (error as { type?: unknown }).type === 'entity.parse.failed'
  );
}

export const errorMiddleware: ErrorRequestHandler = (error, req, res, _next) => {
  const requestId = req.requestId;

  if (isJsonParseError(error)) {
    sendError(
      res,
      {
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Invalid JSON payload',
      },
      { requestId },
      400,
    );
    return;
  }

  if (error instanceof ZodError) {
    sendError(
      res,
      {
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Validation failed',
        details: error.flatten(),
      },
      { requestId },
      400,
    );
    return;
  }

  if (error instanceof multer.MulterError) {
    const isTooLarge = error.code === 'LIMIT_FILE_SIZE';
    sendError(
      res,
      {
        code: isTooLarge ? ErrorCodes.FILE_TOO_LARGE : ErrorCodes.FILE_UPLOAD_FAILED,
        message: isTooLarge ? 'File is too large' : 'File upload failed',
        details: { code: error.code },
      },
      { requestId },
      400,
    );
    return;
  }

  if (error instanceof AppError) {
    sendError(
      res,
      {
        code: error.code,
        message: error.message,
        details: error.details,
        ...(env.NODE_ENV === 'production' ? {} : { stack: error.stack }),
      },
      { requestId },
      error.statusCode,
    );
    return;
  }

  logger.error({ error, requestId }, 'Unhandled application error');

  const internalError = error instanceof Error ? error : new Error('Unknown error');

  sendError(
    res,
    {
      code: ErrorCodes.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      ...(env.NODE_ENV === 'production' ? {} : { stack: internalError.stack }),
    },
    { requestId },
    500,
  );
};

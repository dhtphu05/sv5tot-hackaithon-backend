import type { Response } from 'express';

export type ApiErrorPayload = {
  code: string;
  message: string;
  details?: unknown;
  stack?: string;
};

export type ApiMeta = {
  requestId?: string;
  [key: string]: unknown;
};

export type ApiResponse<T> = {
  success: boolean;
  data: T | null;
  error: ApiErrorPayload | null;
  meta: ApiMeta;
};

export function sendSuccess<T>(
  res: Response,
  data: T,
  meta: ApiMeta = {},
  statusCode = 200,
): Response<ApiResponse<T>> {
  return res.status(statusCode).json({
    success: true,
    data,
    error: null,
    meta,
  });
}

export function sendError(
  res: Response,
  error: ApiErrorPayload,
  meta: ApiMeta = {},
  statusCode = 500,
): Response<ApiResponse<null>> {
  return res.status(statusCode).json({
    success: false,
    data: null,
    error,
    meta,
  });
}

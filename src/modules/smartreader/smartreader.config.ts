import { env } from '../../config/env';

export const smartReaderConfig = {
  enabled: env.VNPT_ENABLED,
  requireRealInPipeline: env.VNPT_REQUIRE_REAL_IN_PIPELINE,
  allowMockRuntime: env.VNPT_ALLOW_MOCK_RUNTIME,
  baseUrl: env.VNPT_BASE_URL.replace(/\/+$/, ''),
  accessToken: env.VNPT_ACCESS_TOKEN,
  tokenId: env.VNPT_TOKEN_ID,
  tokenKey: env.VNPT_TOKEN_KEY,
  macAddress: env.VNPT_MAC_ADDRESS,
  clientSession: env.VNPT_CLIENT_SESSION,
  defaultToken: env.VNPT_DEFAULT_TOKEN,
  timeoutMs: env.VNPT_TIMEOUT_MS,
  retryMax: env.VNPT_RETRY_MAX,
  uploadPath: env.VNPT_UPLOAD_PATH,
  ocrBasicPath: env.VNPT_OCR_BASIC_PATH,
  ocrAdvancedPath: env.VNPT_OCR_ADVANCED_PATH,
  ocrAsyncStartPath: env.VNPT_OCR_ASYNC_START_PATH,
  ocrAsyncResultPath: env.VNPT_OCR_ASYNC_RESULT_PATH,
  ocrAsyncCancelPath: env.VNPT_OCR_ASYNC_CANCEL_PATH,
  adminDocPath: env.VNPT_ADMIN_DOC_PATH,
  uploadForceJsonContentType: env.VNPT_UPLOAD_FORCE_JSON_CONTENT_TYPE,
  saveRawResponse: env.VNPT_SAVE_RAW_RESPONSE,
  logRawResponse: env.VNPT_LOG_RAW_RESPONSE,
} as const;

export type SmartReaderConfig = typeof smartReaderConfig;

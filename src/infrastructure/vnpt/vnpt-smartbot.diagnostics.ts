import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { SmartbotConversationRequest } from '../../modules/chatbot/chatbot.types';

export const smartbotFallbackText =
  'Mình chưa thể kết nối trợ lý hội thoại ngay lúc này. Bạn vẫn có thể dùng các gợi ý nhanh bên dưới để xem hồ sơ còn thiếu gì, mở Gap Analysis, upload minh chứng hoặc hỏi cán bộ phụ trách.';

export type SmartbotPayloadInfo = {
  hasSbObject: boolean;
  cardDataCount: number;
  responseContentType?: string;
};

type DiagnosticInput = {
  request: SmartbotConversationRequest;
  httpStatus?: number;
  errorCode?: string;
  timeout?: boolean;
  responseContentType?: string;
  cardDataCount?: number;
};

export function assertSmartbotEnv(request: SmartbotConversationRequest): void {
  if (
    env.SMARTBOT_MODE === 'mock' ||
    (env.SMARTBOT_BOT_ID &&
      env.SMARTBOT_ACCESS_TOKEN &&
      env.SMARTBOT_TOKEN_ID &&
      env.SMARTBOT_TOKEN_KEY)
  ) {
    return;
  }

  logSmartbotDiagnostic({
    request,
    errorCode: ErrorCodes.SMARTBOT_ENV_MISSING,
  });
  throw new AppError(500, ErrorCodes.SMARTBOT_ENV_MISSING, ErrorCodes.SMARTBOT_ENV_MISSING);
}

export function inspectSmartbotPayload(raw: unknown, responseContentType?: string): SmartbotPayloadInfo {
  const root = asRecord(raw);
  const object = asRecord(root?.object);
  const sb = asRecord(object?.sb) ?? asRecord(root?.sb);
  const cards = Array.isArray(sb?.card_data) ? sb.card_data : [];
  return {
    hasSbObject: Boolean(sb),
    cardDataCount: cards.length,
    responseContentType,
  };
}

export function throwIfEmptySmartbotCards(
  raw: unknown,
  request: SmartbotConversationRequest,
  responseContentType?: string,
): void {
  const info = inspectSmartbotPayload(raw, responseContentType);
  if (!info.hasSbObject || info.cardDataCount > 0) return;
  logSmartbotDiagnostic({
    request,
    errorCode: ErrorCodes.SMARTBOT_EMPTY_CARD_DATA,
    responseContentType: info.responseContentType,
    cardDataCount: info.cardDataCount,
  });
  throw new AppError(502, ErrorCodes.SMARTBOT_EMPTY_CARD_DATA, ErrorCodes.SMARTBOT_EMPTY_CARD_DATA);
}

export function logSmartbotDiagnostic(input: DiagnosticInput): void {
  const diagnostic = {
    requestId: input.request.session_id,
    SMARTBOT_MODE: env.SMARTBOT_MODE,
    baseUrl: env.SMARTBOT_BASE_URL,
    botIdPresent: Boolean(input.request.bot_id || env.SMARTBOT_BOT_ID),
    accessTokenPresent: Boolean(env.SMARTBOT_ACCESS_TOKEN),
    tokenIdPresent: Boolean(env.SMARTBOT_TOKEN_ID),
    tokenKeyPresent: Boolean(env.SMARTBOT_TOKEN_KEY),
    httpStatus: input.httpStatus,
    errorCode: input.errorCode,
    timeoutMs: input.timeout ? env.SMARTBOT_TIMEOUT_MS : undefined,
    responseContentType: input.responseContentType,
    cardDataCount: input.cardDataCount,
  };
  if (input.errorCode) {
    logger.warn(diagnostic, 'VNPT Smartbot diagnostic');
    return;
  }
  logger.info(diagnostic, 'VNPT Smartbot diagnostic');
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

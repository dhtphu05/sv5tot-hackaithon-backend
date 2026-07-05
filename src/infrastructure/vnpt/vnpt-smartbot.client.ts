import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import { redactSmartbotSecrets } from '../../modules/chatbot/chatbot.redactor';
import {
  assertSmartbotEnv,
  inspectSmartbotPayload,
  logSmartbotDiagnostic,
  smartbotFallbackText,
  throwIfEmptySmartbotCards,
} from './vnpt-smartbot.diagnostics';
import type {
  SmartbotClient,
  SmartbotConversationRequest,
} from '../../modules/chatbot/chatbot.types';

export class VnptSmartBotClient implements SmartbotClient {
  async sendMessage(input: SmartbotConversationRequest): Promise<unknown> {
    assertSmartbotEnv(input);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.SMARTBOT_TIMEOUT_MS);

    try {
      const response = await fetch(`${env.SMARTBOT_BASE_URL}/v1/conversation`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${env.SMARTBOT_ACCESS_TOKEN}`,
          'Token-id': env.SMARTBOT_TOKEN_ID,
          'Token-key': env.SMARTBOT_TOKEN_KEY,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(input),
      });
      const responseContentType = response.headers.get('content-type') ?? undefined;
      const body = await parseJsonResponse(response, input, responseContentType);
      const payloadInfo = inspectSmartbotPayload(body, responseContentType);

      if (!response.ok) {
        const code = response.status === 401 || response.status === 403
          ? ErrorCodes.SMARTBOT_AUTH_FAILED
          : ErrorCodes.SMARTBOT_HTTP_ERROR;
        logSmartbotDiagnostic({
          request: input,
          httpStatus: response.status,
          errorCode: code,
          responseContentType,
          cardDataCount: payloadInfo.cardDataCount,
        });
        throw new AppError(response.status, code, code);
      }

      throwIfEmptySmartbotCards(body, input, responseContentType);
      logSmartbotDiagnostic({
        request: input,
        httpStatus: response.status,
        responseContentType,
        cardDataCount: payloadInfo.cardDataCount,
      });

      if (env.SMARTBOT_LOG_RAW_RESPONSE) {
        logger.debug({ response: redactSmartbotSecrets(body) }, 'VNPT Smartbot response');
      }

      return body;
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      if (isAbort) {
        logSmartbotDiagnostic({
          request: input,
          errorCode: ErrorCodes.SMARTBOT_TIMEOUT,
          timeout: true,
        });
        throw new AppError(504, ErrorCodes.SMARTBOT_TIMEOUT, ErrorCodes.SMARTBOT_TIMEOUT);
      }
      if (error instanceof AppError) throw error;
      logSmartbotDiagnostic({
        request: input,
        errorCode: ErrorCodes.SMARTBOT_NETWORK_ERROR,
      });
      throw new AppError(502, ErrorCodes.SMARTBOT_NETWORK_ERROR, ErrorCodes.SMARTBOT_NETWORK_ERROR);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function fallbackResponse(sessionId: string) {
  return {
    object: {
      sb: {
        session_id: sessionId,
        intent_name: 'smartbot_fallback',
        card_data: [
          {
            type: 'text',
            text: smartbotFallbackText,
          },
        ],
        card_data_info: { status: 0 },
      },
    },
  };
}

async function parseJsonResponse(
  response: Response,
  input: SmartbotConversationRequest,
  responseContentType?: string,
): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    logSmartbotDiagnostic({
      request: input,
      httpStatus: response.status,
      errorCode: ErrorCodes.SMARTBOT_PARSE_FAILED,
      responseContentType,
    });
    throw new AppError(502, ErrorCodes.SMARTBOT_PARSE_FAILED, ErrorCodes.SMARTBOT_PARSE_FAILED);
  }
}

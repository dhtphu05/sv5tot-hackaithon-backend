import pino from 'pino';
import { env } from './env';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["token-id"]',
      'req.headers["token-key"]',
      'req.headers["mac-address"]',
      'headers.authorization',
      'headers.Authorization',
      'headers["Token-id"]',
      'headers["Token-key"]',
      'headers["token-id"]',
      'headers["token-key"]',
      'authorization',
      'Authorization',
      'Token-id',
      'Token-key',
      'tokenId',
      'tokenKey',
      'accessToken',
      'access_token',
      'VNPT_ACCESS_TOKEN',
      'VNPT_TOKEN_ID',
      'VNPT_TOKEN_KEY',
      'SMARTBOT_ACCESS_TOKEN',
      'SMARTBOT_TOKEN_ID',
      'SMARTBOT_TOKEN_KEY',
      'SMARTBOT_WEBHOOK_TOKEN',
      'bot_id',
      'token_id',
      'token_key',
      'dataBase64',
      'dataSign',
      '*.dataBase64',
      '*.dataSign',
      'password',
      'passwordHash',
    ],
    remove: true,
  },
  transport:
    env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
          },
        }
      : undefined,
});

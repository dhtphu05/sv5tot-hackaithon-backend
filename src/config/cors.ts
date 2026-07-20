import type { CorsOptions } from 'cors';
import { env } from './env';

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin || isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Origin is not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
};

export function isAllowedOrigin(origin: string) {
  if (env.CORS_ORIGIN.includes(origin)) return true;
  if (env.NODE_ENV === 'production') return false;

  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:') return false;
    if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') return false;

    return env.CORS_ORIGIN.some((allowedOrigin) => {
      try {
        const allowed = new URL(allowedOrigin);
        return (
          allowed.protocol === 'http:' &&
          (allowed.hostname === 'localhost' || allowed.hostname === '127.0.0.1') &&
          allowed.port === parsed.port
        );
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const nodeEnvSchema = z.enum(['development', 'test', 'production']).default('development');

const envSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DEFAULT_SCHOOL_YEAR: z
    .string()
    .regex(/^\d{4}-\d{4}$/)
    .default('2025-2026'),
  JWT_ACCESS_SECRET: z.string().min(1, 'JWT_ACCESS_SECRET is required'),
  JWT_REFRESH_SECRET: z.string().min(1, 'JWT_REFRESH_SECRET is required'),
  JWT_ACCESS_EXPIRES_IN: z.string().min(1).default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().min(1).default('7d'),
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  SEED_DEFAULT_PASSWORD: z.string().min(8).default('Password@123'),
  CORS_ORIGIN: z
    .string()
    .min(1, 'CORS_ORIGIN is required')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().url()).min(1)),
  UPLOAD_DIR: z.string().min(1).default('./uploads'),
  MAX_FILE_SIZE_MB: z.coerce.number().int().positive().default(20),
  STORAGE_DRIVER: z.enum(['local']).default('local'),
  VNPT_MODE: z.enum(['mock', 'live']).default('mock'),
  VNPT_BASE_URL: z.string().optional().default(''),
  VNPT_API_KEY: z.string().optional().default(''),
  SMARTBOT_MODE: z.enum(['mock', 'live']).default('mock'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const details = parsedEnv.error.flatten().fieldErrors;
  throw new Error(`Invalid environment configuration: ${JSON.stringify(details)}`);
}

if (
  parsedEnv.data.NODE_ENV === 'production' &&
  (parsedEnv.data.JWT_ACCESS_SECRET === 'change_me' ||
    parsedEnv.data.JWT_REFRESH_SECRET === 'change_me')
) {
  throw new Error('JWT secrets must be changed in production');
}

export const env = parsedEnv.data;
export type Env = typeof env;

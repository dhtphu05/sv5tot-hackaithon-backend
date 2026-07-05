import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const nodeEnvSchema = z.enum(['development', 'test', 'production']).default('development');

const booleanFromEnv = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
    return false;
  });

const rawEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DEFAULT_SCHOOL_YEAR: z
    .string()
    .regex(/^\d{4}-\d{4}$/)
    .default('2025-2026'),
  JWT_SECRET: z.string().min(1).optional(),
  JWT_ACCESS_SECRET: z.string().min(1).optional(),
  JWT_REFRESH_SECRET: z.string().min(1).optional(),
  JWT_EXPIRES_IN: z.string().min(1).optional(),
  JWT_ACCESS_EXPIRES_IN: z.string().min(1).default('120m'),
  JWT_REFRESH_EXPIRES_IN: z.string().min(1).default('30d'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).optional(),
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
  LOCAL_UPLOAD_DIR: z.string().min(1).optional(),
  UPLOAD_DIR: z.string().min(1).optional(),
  MAX_FILE_SIZE_MB: z.coerce.number().int().positive().default(20),
  STORAGE_DRIVER: z.enum(['local', 'r2']).default('local'),
  R2_BUCKET_NAME: z.string().optional(),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ENDPOINT: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  VNPT_MODE: z.enum(['mock', 'live']).default('mock'),
  VNPT_ENABLED: booleanFromEnv,
  VNPT_REQUIRE_REAL_IN_PIPELINE: booleanFromEnv,
  VNPT_ALLOW_MOCK_RUNTIME: booleanFromEnv,
  VNPT_BASE_URL: z.string().url().default('https://api.idg.vnpt.vn'),
  VNPT_API_KEY: z.string().optional().default(''),
  VNPT_ACCESS_TOKEN: z.string().optional().default(''),
  VNPT_TOKEN_ID: z.string().optional().default(''),
  VNPT_TOKEN_KEY: z.string().optional().default(''),
  VNPT_MAC_ADDRESS: z.string().min(1).default('EGOV-DIGDOC-WEB-API'),
  VNPT_CLIENT_SESSION: z.string().min(1).default('00-14-22-01-23-45-1548211589291'),
  VNPT_DEFAULT_TOKEN: z.string().min(1).default('5tot-backend'),
  VNPT_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  VNPT_RETRY_MAX: z.coerce.number().int().min(0).max(5).default(2),
  VNPT_UPLOAD_PATH: z.string().min(1).default('/file-service/v1/addFile'),
  VNPT_OCR_BASIC_PATH: z.string().min(1).default('/rpa-service/aidigdoc/v1/ocr/scan'),
  VNPT_OCR_ADVANCED_PATH: z.string().min(1).default('/rpa-service/aidigdoc/v1/ocr/scan-table'),
  VNPT_OCR_ASYNC_START_PATH: z
    .string()
    .min(1)
    .default('/rpa-service/aidigdoc/v1/integration/ocr/scan-table'),
  VNPT_OCR_ASYNC_RESULT_PATH: z
    .string()
    .min(1)
    .default('/rpa-service/aidigdoc/v1/integration/ocr/scan-table/result'),
  VNPT_OCR_ASYNC_CANCEL_PATH: z
    .string()
    .min(1)
    .default('/rpa-service/aidigdoc/v1/integration/ocr/scan-table/cancel'),
  VNPT_ADMIN_DOC_PATH: z
    .string()
    .min(1)
    .default('/rpa-service/aidigdoc/v1/vlm/van-ban-hanh-chinh-vnportal'),
  VNPT_UPLOAD_FORCE_JSON_CONTENT_TYPE: booleanFromEnv,
  VNPT_SAVE_RAW_RESPONSE: booleanFromEnv,
  VNPT_LOG_RAW_RESPONSE: booleanFromEnv,
  SMARTREADER_SMOKE_AUDIT_ENABLED: booleanFromEnv,
  SMARTREADER_ASYNC_MAX_POLLS: z.coerce.number().int().positive().default(60),
  JOB_WORKER_ENABLED: booleanFromEnv,
  JOB_WORKER_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  INTERNAL_WORKER_TOKEN: z.string().optional().default(''),
  SMARTBOT_MODE: z.enum(['mock', 'live', 'real']).default('mock'),
  SMARTBOT_BASE_URL: z.string().url().default('https://assistant-stream.vnpt.vn'),
  SMARTBOT_BOT_ID: z.string().optional().default(''),
  SMARTBOT_ACCESS_TOKEN: z.string().optional().default(''),
  SMARTBOT_TOKEN_ID: z.string().optional().default(''),
  SMARTBOT_TOKEN_KEY: z.string().optional().default(''),
  SMARTBOT_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  SMARTBOT_INPUT_CHANNEL: z.string().min(1).default('livechat'),
  SMARTBOT_USE_DYNAMIC_PROMPT: booleanFromEnv,
  SMARTBOT_WEBHOOK_TOKEN: z.string().optional().default(''),
  SMARTBOT_LOG_RAW_RESPONSE: booleanFromEnv,
  GEMINI_ENABLED: booleanFromEnv,
  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_MODEL: z.string().min(1).default('gemini-2.5-flash'),
  GEMINI_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  GEMINI_LOG_RAW_RESPONSE: booleanFromEnv,
  MAIL_ENABLED: booleanFromEnv,
  MAIL_PROVIDER: z.enum(['smtp', 'console']).default('console'),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  MAIL_FROM_NAME: z.string().min(1).default('5TOT'),
  MAIL_FROM_ADDRESS: z.string().email().default('no-reply@example.edu.vn'),
  APP_BASE_URL: z.string().url().default('http://localhost:5173'),
  MAIL_MAX_ATTEMPTS: z.coerce.number().int().positive().max(10).default(3),
  MAIL_RETRY_BASE_SECONDS: z.coerce.number().int().positive().default(60),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
})
  .refine((data) => !!data.JWT_SECRET || (!!data.JWT_ACCESS_SECRET && !!data.JWT_REFRESH_SECRET), {
    message: 'JWT_SECRET or both JWT_ACCESS_SECRET/JWT_REFRESH_SECRET are required',
    path: ['JWT_ACCESS_SECRET'],
  })
  .refine((data) => {
    if (data.STORAGE_DRIVER === 'r2') {
      return (
        !!data.R2_BUCKET_NAME &&
        !!data.R2_ACCOUNT_ID &&
        !!data.R2_ENDPOINT &&
        !!data.R2_ACCESS_KEY_ID &&
        !!data.R2_SECRET_ACCESS_KEY
      );
    }
    return true;
  }, {
    message: 'R2 configurations (R2_BUCKET_NAME, R2_ACCOUNT_ID, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY) are required when STORAGE_DRIVER is set to "r2"',
    path: ['STORAGE_DRIVER'],
  })
  .refine((data) => {
    if (!data.MAIL_ENABLED || data.MAIL_PROVIDER !== 'smtp') {
      return true;
    }
    return !!data.SMTP_HOST && !!data.SMTP_USER && !!data.SMTP_PASSWORD;
  }, {
    message: 'SMTP_HOST, SMTP_USER, and SMTP_PASSWORD are required when MAIL_ENABLED=true and MAIL_PROVIDER=smtp',
    path: ['MAIL_PROVIDER'],
  });

const envInput = {
  ...process.env,
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? process.env.JWT_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? process.env.JWT_SECRET,
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN ?? process.env.JWT_EXPIRES_IN,
  BCRYPT_SALT_ROUNDS: process.env.BCRYPT_SALT_ROUNDS ?? process.env.BCRYPT_ROUNDS,
};

const parsedEnv = rawEnvSchema.safeParse(envInput);

if (!parsedEnv.success) {
  const details = parsedEnv.error.flatten().fieldErrors;
  throw new Error(`Invalid environment configuration: ${JSON.stringify(details)}`);
}

const rawEnv = parsedEnv.data;
const jwtAccessSecret = rawEnv.JWT_ACCESS_SECRET;
const jwtRefreshSecret = rawEnv.JWT_REFRESH_SECRET;

if (!jwtAccessSecret || !jwtRefreshSecret) {
  throw new Error('Invalid environment configuration: JWT_SECRET or both JWT_ACCESS_SECRET/JWT_REFRESH_SECRET are required');
}

const vnptEnabled =
  process.env.VNPT_ENABLED === undefined ? true : rawEnv.VNPT_ENABLED;
const vnptRequireRealInPipeline =
  process.env.VNPT_REQUIRE_REAL_IN_PIPELINE === undefined
    ? true
    : rawEnv.VNPT_REQUIRE_REAL_IN_PIPELINE;
const vnptAllowMockRuntime =
  process.env.VNPT_ALLOW_MOCK_RUNTIME === undefined ? false : rawEnv.VNPT_ALLOW_MOCK_RUNTIME;
const geminiEnabled =
  process.env.GEMINI_ENABLED === undefined ? false : rawEnv.GEMINI_ENABLED;

if (
  vnptEnabled &&
  (!rawEnv.VNPT_ACCESS_TOKEN || !rawEnv.VNPT_TOKEN_ID || !rawEnv.VNPT_TOKEN_KEY)
) {
  throw new Error(
    'Invalid environment configuration: VNPT_ACCESS_TOKEN, VNPT_TOKEN_ID, and VNPT_TOKEN_KEY are required when VNPT_ENABLED=true',
  );
}

if (vnptRequireRealInPipeline && vnptAllowMockRuntime) {
  throw new Error(
    'Invalid environment configuration: VNPT_REQUIRE_REAL_IN_PIPELINE=true cannot be combined with VNPT_ALLOW_MOCK_RUNTIME=true',
  );
}

if (geminiEnabled && !rawEnv.GEMINI_API_KEY) {
  throw new Error('Invalid environment configuration: GEMINI_API_KEY is required when GEMINI_ENABLED=true');
}

if (
  rawEnv.NODE_ENV === 'production' &&
  (jwtAccessSecret === 'change_me' || jwtRefreshSecret === 'change_me')
) {
  throw new Error('JWT secrets must be changed in production');
}

if (rawEnv.NODE_ENV === 'production' && !rawEnv.SMARTBOT_WEBHOOK_TOKEN) {
  throw new Error('Invalid environment configuration: SMARTBOT_WEBHOOK_TOKEN is required in production');
}

export const env = {
  ...rawEnv,
  JWT_ACCESS_SECRET: jwtAccessSecret,
  JWT_REFRESH_SECRET: jwtRefreshSecret,
  JWT_ACCESS_EXPIRES_IN: rawEnv.JWT_ACCESS_EXPIRES_IN,
  BCRYPT_SALT_ROUNDS: rawEnv.BCRYPT_SALT_ROUNDS,
  UPLOAD_DIR: rawEnv.UPLOAD_DIR ?? rawEnv.LOCAL_UPLOAD_DIR ?? './uploads',
  LOCAL_UPLOAD_DIR: rawEnv.LOCAL_UPLOAD_DIR ?? rawEnv.UPLOAD_DIR ?? './uploads',
  VNPT_SAVE_RAW_RESPONSE:
    process.env.VNPT_SAVE_RAW_RESPONSE === undefined ? true : rawEnv.VNPT_SAVE_RAW_RESPONSE,
  VNPT_UPLOAD_FORCE_JSON_CONTENT_TYPE:
    process.env.VNPT_UPLOAD_FORCE_JSON_CONTENT_TYPE === undefined
      ? false
      : rawEnv.VNPT_UPLOAD_FORCE_JSON_CONTENT_TYPE,
  VNPT_LOG_RAW_RESPONSE:
    process.env.VNPT_LOG_RAW_RESPONSE === undefined ? false : rawEnv.VNPT_LOG_RAW_RESPONSE,
  SMARTREADER_SMOKE_AUDIT_ENABLED:
    process.env.SMARTREADER_SMOKE_AUDIT_ENABLED === undefined
      ? false
      : rawEnv.SMARTREADER_SMOKE_AUDIT_ENABLED,
  JOB_WORKER_ENABLED:
    process.env.JOB_WORKER_ENABLED === undefined
      ? rawEnv.NODE_ENV === 'development'
      : rawEnv.JOB_WORKER_ENABLED,
  MAIL_ENABLED: process.env.MAIL_ENABLED === undefined ? false : rawEnv.MAIL_ENABLED,
  VNPT_ENABLED: vnptEnabled,
  VNPT_REQUIRE_REAL_IN_PIPELINE: vnptRequireRealInPipeline,
  VNPT_ALLOW_MOCK_RUNTIME: vnptAllowMockRuntime,
  GEMINI_ENABLED: geminiEnabled,
  GEMINI_LOG_RAW_RESPONSE:
    process.env.GEMINI_LOG_RAW_RESPONSE === undefined ? false : rawEnv.GEMINI_LOG_RAW_RESPONSE,
  SMARTBOT_USE_DYNAMIC_PROMPT:
    process.env.SMARTBOT_USE_DYNAMIC_PROMPT === undefined
      ? true
      : rawEnv.SMARTBOT_USE_DYNAMIC_PROMPT,
  SMARTBOT_LOG_RAW_RESPONSE:
    process.env.SMARTBOT_LOG_RAW_RESPONSE === undefined ? false : rawEnv.SMARTBOT_LOG_RAW_RESPONSE,
};
export type Env = typeof env;

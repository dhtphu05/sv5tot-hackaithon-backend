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

const optionalUrlFromEnv = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().url().optional(),
);
const optionalPasswordFromEnv = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(8).max(128).optional(),
);
const modelFromEnv = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1).default('gpt-6-luna'),
);

const rawEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DEFAULT_SCHOOL_YEAR: z
    .string()
    .regex(/^\d{4}-\d{4}$/)
    .default('2026-2027'),
  JWT_SECRET: z.string().min(1).optional(),
  JWT_ACCESS_SECRET: z.string().min(1).optional(),
  JWT_REFRESH_SECRET: z.string().min(1).optional(),
  JWT_EXPIRES_IN: z.string().min(1).optional(),
  JWT_ACCESS_EXPIRES_IN: z.string().min(1).default('120m'),
  JWT_REFRESH_EXPIRES_IN: z.string().min(1).default('30d'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).optional(),
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  SEED_DEFAULT_PASSWORD: z.string().min(8).default('Password@123'),
  CITY_STAFF_SEED_PASSWORD: optionalPasswordFromEnv,
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
  R2_BUCKET: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ENDPOINT: z.string().optional(),
  R2_REGION: z.string().min(1).default('auto'),
  R2_PUBLIC_BASE_URL: optionalUrlFromEnv,
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  EVIDENCE_ANALYSIS_PROVIDER: z.enum(['openai', 'smartreader', 'mock']).default('openai'),
  OPENAI_API_KEY: z.string().optional().default(''),
  OPENAI_EVIDENCE_MODEL: modelFromEnv,
  OPENAI_EVIDENCE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(30000),
  OPENAI_EVIDENCE_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(1),
  OPENAI_STORE_RESPONSES: booleanFromEnv,
  OPENAI_EVIDENCE_PROMPT_VERSION: z.string().min(1).default('evidence-card-v1'),
  OPENAI_AWARD_ROSTER_MODEL: modelFromEnv,
  OPENAI_DECISION_MODEL: modelFromEnv,
  OPENAI_EVENT_ROSTER_MODEL: modelFromEnv,
  OPENAI_DOCUMENT_EXTRACTION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(120000),
  OPENAI_DOCUMENT_EXTRACTION_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(2),
  OPENAI_AWARD_ROSTER_PROMPT_VERSION: z.string().min(1).default('award-roster-v1'),
  OPENAI_DECISION_PROMPT_VERSION: z.string().min(1).default('decision-document-v1'),
  OPENAI_EVENT_ROSTER_PROMPT_VERSION: z.string().min(1).default('event-roster-v1'),
  ASSISTANT_NARRATIVE_PROVIDER: z.enum(['openai', 'mock', 'disabled']).optional(),
  OPENAI_ASSISTANT_MODEL: modelFromEnv,
  OPENAI_ASSISTANT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(30000),
  OPENAI_ASSISTANT_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(1),
  OPENAI_ASSISTANT_PROMPT_VERSION: z.string().min(1).default('dashboard-assistant-v1'),
  STUDENT_ASSISTANT_PROVIDER: z.enum(['openai', 'mock', 'disabled']).optional(),
  OPENAI_STUDENT_ASSISTANT_MODEL: modelFromEnv,
  OPENAI_STUDENT_ASSISTANT_PROMPT_VERSION: z.string().min(1).default('student-assistant-v1'),
  ASSISTANT_NARRATIVE_CACHE_TTL_MS: z.coerce.number().int().positive().default(900000),
  ASSISTANT_MOCK_STREAM_DELAY_MS: z.coerce.number().int().min(0).max(5000).default(35),
  JOB_WORKER_ENABLED: booleanFromEnv,
  JOB_WORKER_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  JOB_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(3),
  JOB_WORKER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(4),
  JOB_WORKER_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(100).max(60000).default(1000),
  JOB_WORKER_RETRY_MAX_DELAY_MS: z.coerce.number().int().min(1000).max(600000).default(60000),
  JOB_WORKER_STALE_AFTER_MS: z.coerce.number().int().min(60000).max(3600000).default(900000),
  JOB_WORKER_STORAGE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(30000),
  INTERNAL_WORKER_TOKEN: z.string().optional().default(''),
  SMARTBOT_MODE: z.enum(['mock', 'live', 'real']).default('mock'),
  SMARTBOT_INPUT_CHANNEL: z.string().min(1).default('livechat'),
  SMARTBOT_WEBHOOK_TOKEN: z.string().optional().default(''),
  ENABLE_DEMO_REVIEW_BYPASS: booleanFromEnv,
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
        !!data.R2_ENDPOINT &&
        !!data.R2_ACCESS_KEY_ID &&
        !!data.R2_SECRET_ACCESS_KEY
      );
    }
    return true;
  }, {
    message: 'R2 configurations (R2_BUCKET or R2_BUCKET_NAME, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY) are required when STORAGE_DRIVER is set to "r2"',
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
  })
  .refine((data) => {
    if (data.NODE_ENV !== 'test' && data.EVIDENCE_ANALYSIS_PROVIDER !== 'openai') {
      return false;
    }
    return true;
  }, {
    message: 'EVIDENCE_ANALYSIS_PROVIDER must be openai outside test',
    path: ['EVIDENCE_ANALYSIS_PROVIDER'],
  })
  .refine((data) => {
    if (
      data.NODE_ENV !== 'test' &&
      data.ASSISTANT_NARRATIVE_PROVIDER &&
      data.ASSISTANT_NARRATIVE_PROVIDER !== 'openai'
    ) {
      return false;
    }
    return true;
  }, {
    message: 'ASSISTANT_NARRATIVE_PROVIDER must be openai outside test',
    path: ['ASSISTANT_NARRATIVE_PROVIDER'],
  })
  .refine((data) => {
    if (
      data.NODE_ENV !== 'test' &&
      data.STUDENT_ASSISTANT_PROVIDER &&
      data.STUDENT_ASSISTANT_PROVIDER !== 'openai'
    ) {
      return false;
    }
    return true;
  }, {
    message: 'STUDENT_ASSISTANT_PROVIDER must be openai outside test',
    path: ['STUDENT_ASSISTANT_PROVIDER'],
  })
  .refine((data) => {
    if (data.EVIDENCE_ANALYSIS_PROVIDER !== 'openai') {
      return true;
    }
    return !!data.OPENAI_API_KEY && !!data.OPENAI_EVIDENCE_MODEL;
  }, {
    message: 'OPENAI_API_KEY and OPENAI_EVIDENCE_MODEL are required when EVIDENCE_ANALYSIS_PROVIDER=openai',
    path: ['EVIDENCE_ANALYSIS_PROVIDER'],
  })
  .refine((data) => {
    if (data.ASSISTANT_NARRATIVE_PROVIDER !== 'openai') {
      return true;
    }
    return !!data.OPENAI_API_KEY && !!data.OPENAI_ASSISTANT_MODEL;
  }, {
    message: 'OPENAI_API_KEY and OPENAI_ASSISTANT_MODEL are required when ASSISTANT_NARRATIVE_PROVIDER=openai',
    path: ['ASSISTANT_NARRATIVE_PROVIDER'],
  })
  .refine((data) => {
    if (data.STUDENT_ASSISTANT_PROVIDER !== 'openai') {
      return true;
    }
    return !!data.OPENAI_API_KEY && !!data.OPENAI_STUDENT_ASSISTANT_MODEL;
  }, {
    message: 'OPENAI_API_KEY and OPENAI_STUDENT_ASSISTANT_MODEL are required when STUDENT_ASSISTANT_PROVIDER=openai',
    path: ['STUDENT_ASSISTANT_PROVIDER'],
  })
  .refine((data) => {
    if (data.NODE_ENV === 'test') {
      return true;
    }
    return (
      !!data.OPENAI_API_KEY &&
      !!data.OPENAI_EVIDENCE_MODEL &&
      !!data.OPENAI_ASSISTANT_MODEL &&
      !!data.OPENAI_STUDENT_ASSISTANT_MODEL
    );
  }, {
    message: 'OpenAI evidence, dashboard assistant, and student assistant models are required outside test',
    path: ['OPENAI_API_KEY'],
  });

const envInput = {
  ...process.env,
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? process.env.JWT_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? process.env.JWT_SECRET,
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN ?? process.env.JWT_EXPIRES_IN,
  BCRYPT_SALT_ROUNDS: process.env.BCRYPT_SALT_ROUNDS ?? process.env.BCRYPT_ROUNDS,
  R2_BUCKET_NAME: process.env.R2_BUCKET_NAME ?? process.env.R2_BUCKET,
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

if (
  rawEnv.NODE_ENV === 'production' &&
  (jwtAccessSecret === 'change_me' || jwtRefreshSecret === 'change_me')
) {
  throw new Error('JWT secrets must be changed in production');
}

if (
  rawEnv.NODE_ENV === 'production' &&
  rawEnv.SMARTBOT_MODE !== 'mock' &&
  !rawEnv.SMARTBOT_WEBHOOK_TOKEN
) {
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
  EVIDENCE_ANALYSIS_PROVIDER:
    rawEnv.NODE_ENV === 'test' ? rawEnv.EVIDENCE_ANALYSIS_PROVIDER : 'openai',
  OPENAI_API_KEY: rawEnv.OPENAI_API_KEY,
  OPENAI_EVIDENCE_MODEL: rawEnv.OPENAI_EVIDENCE_MODEL,
  OPENAI_EVIDENCE_TIMEOUT_MS: rawEnv.OPENAI_EVIDENCE_TIMEOUT_MS,
  OPENAI_EVIDENCE_MAX_RETRIES: rawEnv.OPENAI_EVIDENCE_MAX_RETRIES,
  OPENAI_STORE_RESPONSES:
    process.env.OPENAI_STORE_RESPONSES === undefined ? false : rawEnv.OPENAI_STORE_RESPONSES,
  OPENAI_EVIDENCE_PROMPT_VERSION: rawEnv.OPENAI_EVIDENCE_PROMPT_VERSION,
  OPENAI_AWARD_ROSTER_MODEL: rawEnv.OPENAI_AWARD_ROSTER_MODEL,
  OPENAI_DECISION_MODEL: rawEnv.OPENAI_DECISION_MODEL,
  OPENAI_EVENT_ROSTER_MODEL: rawEnv.OPENAI_EVENT_ROSTER_MODEL,
  OPENAI_DOCUMENT_EXTRACTION_TIMEOUT_MS: rawEnv.OPENAI_DOCUMENT_EXTRACTION_TIMEOUT_MS,
  OPENAI_DOCUMENT_EXTRACTION_MAX_RETRIES: rawEnv.OPENAI_DOCUMENT_EXTRACTION_MAX_RETRIES,
  OPENAI_AWARD_ROSTER_PROMPT_VERSION: rawEnv.OPENAI_AWARD_ROSTER_PROMPT_VERSION,
  OPENAI_DECISION_PROMPT_VERSION: rawEnv.OPENAI_DECISION_PROMPT_VERSION,
  OPENAI_EVENT_ROSTER_PROMPT_VERSION: rawEnv.OPENAI_EVENT_ROSTER_PROMPT_VERSION,
  ASSISTANT_NARRATIVE_PROVIDER:
    rawEnv.NODE_ENV === 'test' ? (rawEnv.ASSISTANT_NARRATIVE_PROVIDER ?? 'mock') : 'openai',
  OPENAI_ASSISTANT_MODEL: rawEnv.OPENAI_ASSISTANT_MODEL,
  OPENAI_ASSISTANT_TIMEOUT_MS: rawEnv.OPENAI_ASSISTANT_TIMEOUT_MS,
  OPENAI_ASSISTANT_MAX_RETRIES: rawEnv.OPENAI_ASSISTANT_MAX_RETRIES,
  OPENAI_ASSISTANT_PROMPT_VERSION: rawEnv.OPENAI_ASSISTANT_PROMPT_VERSION,
  STUDENT_ASSISTANT_PROVIDER:
    rawEnv.NODE_ENV === 'test' ? (rawEnv.STUDENT_ASSISTANT_PROVIDER ?? 'mock') : 'openai',
  OPENAI_STUDENT_ASSISTANT_MODEL: rawEnv.OPENAI_STUDENT_ASSISTANT_MODEL,
  OPENAI_STUDENT_ASSISTANT_PROMPT_VERSION: rawEnv.OPENAI_STUDENT_ASSISTANT_PROMPT_VERSION,
  ASSISTANT_NARRATIVE_CACHE_TTL_MS: rawEnv.ASSISTANT_NARRATIVE_CACHE_TTL_MS,
  ASSISTANT_MOCK_STREAM_DELAY_MS: rawEnv.ASSISTANT_MOCK_STREAM_DELAY_MS,
  JOB_WORKER_ENABLED:
    process.env.JOB_WORKER_ENABLED === undefined
      ? rawEnv.NODE_ENV === 'development'
      : rawEnv.JOB_WORKER_ENABLED,
  MAIL_ENABLED: process.env.MAIL_ENABLED === undefined ? false : rawEnv.MAIL_ENABLED,
  ENABLE_DEMO_REVIEW_BYPASS: rawEnv.ENABLE_DEMO_REVIEW_BYPASS,
};
export type Env = typeof env;

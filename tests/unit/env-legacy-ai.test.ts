import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('legacy AI provider environment compatibility', () => {
  it('does not require retired VNPT or Gemini credentials to start the OpenAI runtime', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '-e',
        `const { env } = require('./src/config/env');
         process.stdout.write(JSON.stringify({
           nodeEnv: env.NODE_ENV,
           hasGemini: Object.hasOwn(env, 'GEMINI_ENABLED'),
           hasVnpt: Object.hasOwn(env, 'VNPT_ENABLED'),
           hasSmartbotToken: Object.hasOwn(env, 'SMARTBOT_ACCESS_TOKEN'),
         }));`,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          NODE_ENV: 'production',
          DATABASE_URL: 'postgresql://local:local@127.0.0.1:5432/app',
          JWT_ACCESS_SECRET: 'test-access-secret',
          JWT_REFRESH_SECRET: 'test-refresh-secret',
          CORS_ORIGIN: 'http://localhost:5173',
          OPENAI_API_KEY: 'sk-test-placeholder',
          EVIDENCE_ANALYSIS_PROVIDER: 'openai',
          ASSISTANT_NARRATIVE_PROVIDER: 'openai',
          STUDENT_ASSISTANT_PROVIDER: 'openai',
          VNPT_MODE: 'live',
          VNPT_ENABLED: 'true',
          VNPT_ACCESS_TOKEN: '',
          VNPT_TOKEN_ID: '',
          VNPT_TOKEN_KEY: '',
          GEMINI_ENABLED: 'true',
          GEMINI_API_KEY: '',
          SMARTBOT_MODE: 'mock',
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      nodeEnv: 'production',
      hasGemini: false,
      hasVnpt: false,
      hasSmartbotToken: false,
    });
  });
});

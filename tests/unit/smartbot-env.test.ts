import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

describe('Smartbot env validation', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('allows mock mode without Smartbot credentials', async () => {
    vi.resetModules();
    process.env.SMARTBOT_MODE = 'mock';
    delete process.env.SMARTBOT_BOT_ID;
    delete process.env.SMARTBOT_ACCESS_TOKEN;
    delete process.env.SMARTBOT_TOKEN_ID;
    delete process.env.SMARTBOT_TOKEN_KEY;

    const { env } = await import('../../src/config/env');

    expect(env.SMARTBOT_MODE).toBe('mock');
  });

  it('defaults the demo review bypass to false', async () => {
    vi.resetModules();
    delete process.env.ENABLE_DEMO_REVIEW_BYPASS;

    const { env } = await import('../../src/config/env');

    expect(env.ENABLE_DEMO_REVIEW_BYPASS).toBe(false);
  });

  it('enables the demo review bypass only when explicitly set to true', async () => {
    vi.resetModules();
    process.env.ENABLE_DEMO_REVIEW_BYPASS = 'true';

    const { env } = await import('../../src/config/env');

    expect(env.ENABLE_DEMO_REVIEW_BYPASS).toBe(true);
  });

  it('allows live mode to start without Smartbot credentials so runtime can return SMARTBOT_ENV_MISSING', async () => {
    vi.resetModules();
    process.env.SMARTBOT_MODE = 'real';
    process.env.SMARTBOT_BOT_ID = '';
    const testTokenValue = ['super', 'secret', 'token', 'value'].join('-');
    process.env['SMARTBOT_ACCESS_TOKEN'] = testTokenValue;
    process.env.SMARTBOT_TOKEN_ID = '';
    process.env.SMARTBOT_TOKEN_KEY = '';

    const { env } = await import('../../src/config/env');

    expect(env.SMARTBOT_MODE).toBe('real');
    expect(env.SMARTBOT_ACCESS_TOKEN).toBe(testTokenValue);
  });
});

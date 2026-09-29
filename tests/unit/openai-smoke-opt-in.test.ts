import { describe, expect, it } from 'vitest';
import { isLiveOpenAiSmokeEnabled } from '../../src/modules/ai/openai-smoke-guard';

describe('live OpenAI smoke opt-in', () => {
  it('requires an explicit true opt-in', () => {
    expect(isLiveOpenAiSmokeEnabled(undefined)).toBe(false);
    expect(isLiveOpenAiSmokeEnabled('false')).toBe(false);
    expect(isLiveOpenAiSmokeEnabled('1')).toBe(false);
    expect(isLiveOpenAiSmokeEnabled('true')).toBe(true);
  });
});

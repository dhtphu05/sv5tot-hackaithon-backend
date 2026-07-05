import { describe, expect, it } from 'vitest';
import { redactSmartbotSecrets } from '../../src/modules/chatbot/chatbot.redactor';

describe('redactSmartbotSecrets', () => {
  it('redacts tokens and unsafe personal fields recursively', () => {
    const redacted = redactSmartbotSecrets({
      Authorization: 'Bearer token',
      tokenKey: 'secret',
      nested: {
        email: 'student@example.com',
        studentCode: '21IT999',
        ok: 'safe',
      },
    });

    expect(redacted).toEqual({
      Authorization: '[REDACTED]',
      tokenKey: '[REDACTED]',
      nested: {
        email: '[REDACTED]',
        studentCode: '[REDACTED]',
        ok: 'safe',
      },
    });
  });
});

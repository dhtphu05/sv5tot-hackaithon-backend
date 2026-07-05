import { afterEach, describe, expect, it, vi } from 'vitest';
import { VnptSmartBotClient } from '../../src/infrastructure/vnpt/vnpt-smartbot.client';
import { AppError } from '../../src/shared/errors/app-error';
import { ErrorCodes } from '../../src/shared/errors/error-codes';

describe('VnptSmartBotClient diagnostics', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws SMARTBOT_AUTH_FAILED for 401/403 without exposing credentials', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ message: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal(
      'fetch',
      fetchMock,
    );

    await expect(new VnptSmartBotClient().sendMessage(baseRequest('s-auth'))).rejects.toMatchObject({
      code: ErrorCodes.SMARTBOT_AUTH_FAILED,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/conversation'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Accept: 'application/json',
        }),
      }),
    );
  });

  it('throws SMARTBOT_HTTP_ERROR for non-auth HTTP failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ message: 'bad gateway' }), {
          status: 502,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await expect(new VnptSmartBotClient().sendMessage(baseRequest('s-http'))).rejects.toMatchObject({
      code: ErrorCodes.SMARTBOT_HTTP_ERROR,
    });
  });

  it('throws SMARTBOT_PARSE_FAILED for malformed JSON response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('not-json', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await expect(new VnptSmartBotClient().sendMessage(baseRequest('s-parse'))).rejects.toBeInstanceOf(AppError);
    await expect(new VnptSmartBotClient().sendMessage(baseRequest('s-parse'))).rejects.toMatchObject({
      code: ErrorCodes.SMARTBOT_PARSE_FAILED,
    });
  });

  it('throws SMARTBOT_EMPTY_CARD_DATA when VNPT returns object.sb without card_data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ object: { sb: { session_id: 's-empty', card_data_info: { status: 0 } } } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await expect(new VnptSmartBotClient().sendMessage(baseRequest('s-empty'))).rejects.toMatchObject({
      code: ErrorCodes.SMARTBOT_EMPTY_CARD_DATA,
    });
  });
});

function baseRequest(sessionId: string) {
  return {
    bot_id: 'bot',
    sender_id: 'sender',
    text: 'hello',
    input_channel: 'livechat',
    session_id: sessionId,
    metadata: { button_variables: [] },
  };
}

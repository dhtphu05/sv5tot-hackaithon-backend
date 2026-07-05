import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractStreamObjects,
  VnptSmartBotStreamClient,
} from '../../src/infrastructure/vnpt/vnpt-smartbot-stream.client';
import { ErrorCodes } from '../../src/shared/errors/error-codes';

describe('VnptSmartBotStreamClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses SSE data frames and newline JSON chunks', () => {
    const sse = extractStreamObjects('data: {"a":1}\n\n: keepalive\n\ndata: {"b":2}\n\n');
    expect(sse.objects).toEqual([{ a: 1 }, { b: 2 }]);

    const ndjson = extractStreamObjects('{"a":1}\n{"b":2}\n');
    expect(ndjson.objects).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('handles JSON content-type as final response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            object: {
              sb: {
                session_id: 's-json',
                card_data: [{ type: 'text', text: 'Câu trả lời hoàn chỉnh.' }],
                card_data_info: { status: 0 },
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    const client = new VnptSmartBotStreamClient();
    const finals: unknown[] = [];

    const result = await client.streamMessage(baseRequest('s-json'), {
      onFinal: (data) => {
        finals.push(data);
      },
    });

    expect(result.answer).toBe('Câu trả lời hoàn chỉnh.');
    expect(finals).toHaveLength(1);
  });

  it('streams status 1 delta and status 2 final response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          [
            'data: {"object":{"sb":{"session_id":"s-stream","card_data":[{"type":"text","text":"Xin chào"}],"card_data_info":{"status":1}}}}\n\n',
            'data: {"object":{"sb":{"session_id":"s-stream","card_data":[{"type":"text","text":"Xin chào bạn"}],"card_data_info":{"status":2}}}}\n\n',
          ].join(''),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
      ),
    );
    const client = new VnptSmartBotStreamClient();
    const deltas: string[] = [];
    const cards: unknown[] = [];
    const finals: unknown[] = [];

    const result = await client.streamMessage(baseRequest('s-stream'), {
      onDelta: (text) => {
        deltas.push(text);
      },
      onCard: (data) => {
        cards.push(data);
      },
      onFinal: (data) => {
        finals.push(data);
      },
    });

    expect(deltas.join('')).toBe('Xin chào bạn');
    expect(cards).toHaveLength(1);
    expect(finals).toHaveLength(1);
    expect(result.smartbot.status).toBe(2);
  });

  it('throws SMARTBOT_AUTH_FAILED for 401/403 stream response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ message: 'forbidden' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await expect(new VnptSmartBotStreamClient().streamMessage(baseRequest('s-auth'), {})).rejects.toMatchObject({
      code: ErrorCodes.SMARTBOT_AUTH_FAILED,
    });
  });

  it('throws SMARTBOT_HTTP_ERROR for non-auth stream HTTP failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ message: 'bad gateway' }), {
          status: 502,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await expect(new VnptSmartBotStreamClient().streamMessage(baseRequest('s-http'), {})).rejects.toMatchObject({
      code: ErrorCodes.SMARTBOT_HTTP_ERROR,
    });
  });

  it('throws SMARTBOT_EMPTY_CARD_DATA for JSON stream fallback with empty sb payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ object: { sb: { session_id: 's-empty', card_data: [] } } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await expect(new VnptSmartBotStreamClient().streamMessage(baseRequest('s-empty'), {})).rejects.toMatchObject({
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

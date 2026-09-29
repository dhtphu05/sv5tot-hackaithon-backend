import { describe, expect, it, vi } from 'vitest';
import { logger } from '../../src/config/logger';
import { OpenAiChatbotClient } from '../../src/modules/chatbot/openai-chatbot.client';
import type { SmartbotConversationRequest } from '../../src/modules/chatbot/chatbot.types';

const request: SmartbotConversationRequest = {
  bot_id: 'legacy-bot-id',
  sender_id: 'fivetot-student-private-id',
  text: 'Tôi cần làm gì tiếp theo? email student@example.com',
  input_channel: 'livechat',
  session_id: 'session-1',
  metadata: {
    button_variables: [
      { variableName: 'role', value: 'student' },
      { variableName: 'next_action', value: 'Kiểm tra minh chứng' },
    ],
  },
};

describe('OpenAiChatbotClient', () => {
  it('uses bounded OpenAI output grounded in backend context and adapts to the existing response contract', async () => {
    const telemetryLog = vi.spyOn(logger, 'info');
    const create = vi.fn().mockResolvedValue({
      _request_id: 'req-chatbot-1',
      output_text: JSON.stringify({ answer: 'Bạn hãy kiểm tra minh chứng đang chờ xác nhận.' }),
      usage: { input_tokens: 55, output_tokens: 13, total_tokens: 68 },
    });
    const client = new OpenAiChatbotClient({ responses: { create } } as never);

    const raw = await client.sendMessage(request);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'test-assistant-model',
        store: false,
        safety_identifier: expect.stringMatching(/^chatbot_/),
        metadata: expect.objectContaining({
          use_case: 'chatbot',
          prompt_version: expect.any(String),
          request_id: expect.any(String),
        }),
        text: expect.objectContaining({
          format: expect.objectContaining({ type: 'json_schema', strict: true, name: 'chatbot_answer' }),
        }),
      }),
      expect.objectContaining({ timeout: expect.any(Number), maxRetries: 0 }),
    );
    const sent = create.mock.calls[0]?.[0];
    expect(JSON.stringify(sent)).not.toContain('fivetot-student-private-id');
    expect(JSON.stringify(sent)).not.toContain('student@example.com');
    expect(JSON.stringify(sent)).toContain('Kiểm tra minh chứng');
    expect(raw).toMatchObject({
      object: {
        sb: {
          session_id: 'session-1',
          card_data_info: { status: 1 },
          card_data: [{ type: 'text', text: 'Bạn hãy kiểm tra minh chứng đang chờ xác nhận.' }],
        },
      },
    });
    expect(telemetryLog).toHaveBeenCalledWith(
      expect.objectContaining({ useCase: 'chatbot', requestId: 'req-chatbot-1', totalTokens: 68 }),
      'OpenAI request completed',
    );
    telemetryLog.mockRestore();
  });

  it('exposes a streamed existing chatbot contract without allowing generated actions', async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: JSON.stringify({ answer: 'Thông tin hồ sơ do hệ thống cung cấp.' }),
      usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
    });
    const client = new OpenAiChatbotClient({ responses: { create } } as never);
    const deltas: string[] = [];
    const finals: unknown[] = [];

    await client.streamMessage(request, {
      onDelta: (text) => { deltas.push(text); },
      onFinal: (response) => { finals.push(response); },
    });

    expect(deltas.join('')).toContain('Thông tin hồ sơ');
    expect(finals).toHaveLength(1);
    expect(finals[0]).toMatchObject({ actions: [], handoffRequired: false });
  });

  it('rejects refused or invalid structured output so the caller can use its deterministic fallback', async () => {
    const refused = new OpenAiChatbotClient({
      responses: {
        create: vi.fn().mockResolvedValue({
          output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }],
        }),
      },
    } as never);
    await expect(refused.sendMessage(request)).rejects.toMatchObject({ code: 'OPENAI_REFUSED' });

    const invalid = new OpenAiChatbotClient({
      responses: { create: vi.fn().mockResolvedValue({ output_text: '{"answer":4}' }) },
    } as never);
    await expect(invalid.sendMessage(request)).rejects.toMatchObject({ code: 'OPENAI_INVALID_OUTPUT' });
  });
});

import { Role } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { MockSmartbotClient } from '../../src/infrastructure/vnpt/mock-smartbot.client';
import { buildNoopChatbotService } from '../../src/modules/chatbot/chatbot.service';

const demoUser = {
  id: '2e2031e8-bd75-4d93-9b7a-78a8f31f4e22',
  email: 'student@example.com',
  role: Role.officer,
  fullName: 'Demo Student',
  studentCode: null,
  className: null,
  faculty: null,
  avatarUrl: null,
};

describe('ChatbotService streaming', () => {
  it('streams mock RAG answers with delta and final events', async () => {
    const service = buildNoopChatbotService(new MockSmartbotClient());
    const events: Array<{ event: string; data: unknown }> = [];

    await service.streamMessage(
      demoUser,
      {
        text: 'Cấp Trường cần tiêu chí tình nguyện gì?',
        contextScope: 'student_helpdesk',
        pageContext: { page: 'dashboard' },
      },
      {
        onMeta: (data) => {
          events.push({ event: 'meta', data });
        },
        onDelta: (data) => {
          events.push({ event: 'delta', data });
        },
        onCard: (data) => {
          events.push({ event: 'card', data });
        },
        onFinal: (data) => {
          events.push({ event: 'final', data });
        },
      },
    );

    expect(events[0]).toMatchObject({ event: 'meta', data: { mode: 'stream' } });
    expect(events.some((event) => event.event === 'delta')).toBe(true);
    expect(events.at(-1)).toMatchObject({
      event: 'final',
      data: expect.objectContaining({ answer: expect.stringContaining('tiêu chí Tình nguyện tốt') }),
    });
    expect(JSON.stringify(events)).not.toContain('SMARTBOT_ACCESS_TOKEN');
  });

  it('streams school demo gap as staged progress, card, and final', async () => {
    const service = buildNoopChatbotService(new MockSmartbotClient());
    const events: Array<{ event: string; data: unknown }> = [];

    await service.streamMessage(
      demoUser,
      {
        text: 'Hồ sơ cấp Trường của em còn thiếu gì?',
        contextScope: 'student_helpdesk',
        pageContext: { page: 'dashboard' },
      },
      {
        onMeta: (data) => {
          events.push({ event: 'meta', data });
        },
        onDelta: (data) => {
          events.push({ event: 'delta', data });
        },
        onCard: (data) => {
          events.push({ event: 'card', data });
        },
        onFinal: (data) => {
          events.push({ event: 'final', data });
        },
      },
    );

    expect(events[0]?.event).toBe('meta');
    expect(events[1]?.event).toBe('delta');
    expect(events[2]?.event).toBe('delta');
    expect(events.at(-2)?.event).toBe('card');
    expect(events.at(-1)?.event).toBe('final');
    expect(events[1]).toMatchObject({
      event: 'delta',
      data: { text: 'Mình đang kiểm tra dữ liệu hồ sơ cấp Trường...' },
    });
    expect(events[2]).toMatchObject({
      event: 'delta',
      data: { text: 'Đã tìm thấy 2 điểm cần xử lý.' },
    });
    expect(events.at(-2)).toMatchObject({
      event: 'card',
      data: {
        messages: [
          expect.objectContaining({
            type: 'action_cards',
            title: 'Hồ sơ cấp Trường còn thiếu',
          }),
        ],
        actions: expect.arrayContaining([
          expect.objectContaining({ label: 'Tìm minh chứng tình nguyện' }),
          expect.objectContaining({ label: 'Upload minh chứng thể lực' }),
        ]),
      },
    });
  });

  it('streams school demo evidence summary without fallback text', async () => {
    const service = buildNoopChatbotService(new MockSmartbotClient());
    const events: Array<{ event: string; data: unknown }> = [];

    await service.streamMessage(
      demoUser,
      {
        text: 'hiện tại em đang có những minh chứng gì rồi ạ',
        contextScope: 'student_helpdesk',
        pageContext: { page: 'dashboard' },
      },
      {
        onMeta: (data) => {
          events.push({ event: 'meta', data });
        },
        onDelta: (data) => {
          events.push({ event: 'delta', data });
        },
        onCard: (data) => {
          events.push({ event: 'card', data });
        },
        onFinal: (data) => {
          events.push({ event: 'final', data });
        },
      },
    );

    const final = events.at(-1)?.data;
    expect(final).toMatchObject({
      answer: expect.stringContaining('Mình đã kiểm tra dữ liệu hồ sơ cấp Trường'),
      messages: [
        expect.objectContaining({
          title: 'Minh chứng hiện có trong hồ sơ cấp Trường',
          items: expect.arrayContaining([
            expect.objectContaining({ title: 'Hiến máu nhân đạo đợt 1' }),
            expect.objectContaining({ title: 'Thể lực tốt', status: 'Chưa có minh chứng' }),
          ]),
        }),
      ],
    });
    expect(JSON.stringify(events)).not.toContain('Mình chưa thể kết nối trợ lý hội thoại');
  });
});

import { Role } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { MockSmartbotClient } from '../../src/infrastructure/vnpt/mock-smartbot.client';
import { buildNoopChatbotService } from '../../src/modules/chatbot/chatbot.service';
import type { SmartbotClient, SmartbotConversationRequest } from '../../src/modules/chatbot/chatbot.types';
import { AppError } from '../../src/shared/errors/app-error';
import { ErrorCodes } from '../../src/shared/errors/error-codes';

describe('ChatbotService', () => {
  it('returns normalized mock response with contextual actions', async () => {
    const service = buildNoopChatbotService(new MockSmartbotClient());
    const result = await service.sendMessage(
      {
        id: '2e2031e8-bd75-4d93-9b7a-78a8f31f4e22',
        email: 'officer@example.com',
        role: Role.officer,
        fullName: 'Officer',
        studentCode: null,
        className: null,
        faculty: null,
        avatarUrl: null,
        workspaceId: null,
        workspace: null,
      },
      {
        text: 'Soạn yêu cầu bổ sung',
        contextScope: 'reviewer_copilot',
        pageContext: { page: 'review_task' },
      },
    );

    expect(result.sessionId).toEqual(expect.any(String));
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Soạn yêu cầu bổ sung', type: 'postback' }),
        expect.objectContaining({ label: 'Chuyển Resolution Hub', type: 'navigate' }),
      ]),
    );
  });

  it('maps handoff mock response to handoff action', async () => {
    const service = buildNoopChatbotService(new MockSmartbotClient());
    const result = await service.sendMessage(
      {
        id: '2e2031e8-bd75-4d93-9b7a-78a8f31f4e22',
        email: 'student@example.com',
        role: Role.officer,
        fullName: 'Officer',
        studentCode: null,
        className: null,
        faculty: null,
        avatarUrl: null,
        workspaceId: null,
        workspace: null,
      },
      { text: 'Em cần chuyển cán bộ', contextScope: 'reviewer_copilot' },
    );

    expect(result.handoffRequired).toBe(true);
    expect(result.actions).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'Tạo yêu cầu hỗ trợ cán bộ' })]),
    );
  });

  it('returns school demo gap cards and actions', async () => {
    const service = buildNoopChatbotService(new MockSmartbotClient());
    const result = await service.sendMessage(
      {
        id: '2e2031e8-bd75-4d93-9b7a-78a8f31f4e22',
        email: 'student@example.com',
        role: Role.officer,
        fullName: 'Demo Student',
        studentCode: null,
        className: null,
        faculty: null,
        avatarUrl: null,
        workspaceId: null,
        workspace: null,
      },
      {
        text: 'Hồ sơ cấp Trường của em còn thiếu gì?',
        contextScope: 'student_helpdesk',
        pageContext: { page: 'dashboard' },
      },
    );

    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'action_cards',
          title: 'Hồ sơ cấp Trường còn thiếu',
          items: expect.arrayContaining([
            expect.objectContaining({ type: 'gap_item', title: 'Tình nguyện tốt' }),
            expect.objectContaining({ type: 'gap_item', title: 'Thể lực tốt' }),
          ]),
        }),
      ]),
    );
    expect(result.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Tìm minh chứng tình nguyện', type: 'navigate' }),
        expect.objectContaining({ label: 'Upload minh chứng thể lực', type: 'navigate' }),
        expect.objectContaining({ label: 'Hỏi cán bộ phụ trách', type: 'execute', requiresConfirmation: true }),
      ]),
    );
  });

  it('returns school demo evidence summary without Smartbot fallback', async () => {
    const service = buildNoopChatbotService(new FailingSmartbotClient());
    const result = await service.sendMessage(
      {
        id: '2e2031e8-bd75-4d93-9b7a-78a8f31f4e22',
        email: 'student@example.com',
        role: Role.officer,
        fullName: 'Demo Student',
        studentCode: null,
        className: null,
        faculty: null,
        avatarUrl: null,
        workspaceId: null,
        workspace: null,
      },
      {
        text: 'hiện tại em đang có những minh chứng gì rồi ạ',
        contextScope: 'student_helpdesk',
        pageContext: { page: 'dashboard' },
      },
    );

    expect(result.answer).toContain('Mình đã kiểm tra dữ liệu demo của hồ sơ cấp Trường');
    expect(result.answer).toContain('Hệ thống chỉ hỗ trợ tiền kiểm và giải thích.');
    expect(result.answer).not.toContain('Mình chưa thể kết nối trợ lý hội thoại');
    expect(result.messages[0]).toMatchObject({
      type: 'action_cards',
      title: 'Minh chứng hiện có trong hồ sơ cấp Trường',
      items: expect.arrayContaining([
        expect.objectContaining({ title: 'Hiến máu nhân đạo đợt 1', status: 'Đã ghi nhận' }),
        expect.objectContaining({ title: 'Thể lực tốt', status: 'Chưa có minh chứng' }),
      ]),
    });
    expect(JSON.stringify(result)).not.toContain('currently');
    expect(JSON.stringify(result)).not.toContain('missing evidence');
  });

  it('returns school demo matching hub cards', async () => {
    const service = buildNoopChatbotService(new MockSmartbotClient());
    const result = await service.sendMessage(
      {
        id: '2e2031e8-bd75-4d93-9b7a-78a8f31f4e22',
        email: 'student@example.com',
        role: Role.officer,
        fullName: 'Demo Student',
        studentCode: null,
        className: null,
        faculty: null,
        avatarUrl: null,
        workspaceId: null,
        workspace: null,
      },
      {
        text: 'Tìm minh chứng tình nguyện',
        contextScope: 'student_helpdesk',
        pageContext: { page: 'matching_hub' },
      },
    );

    expect(result.messages[0]).toMatchObject({
      type: 'action_cards',
      title: 'Minh chứng tìm thấy trong Matching Hub',
    });
    expect(result.messages[0].items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'matching_event', title: 'Mùa hè xanh 2025' }),
        expect.objectContaining({ type: 'matching_event', title: 'Hiến máu nhân đạo đợt 1' }),
      ]),
    );
    expect(result.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Thêm vào hồ sơ', type: 'execute', requiresConfirmation: true }),
      ]),
    );
  });

  it('returns school demo handoff card', async () => {
    const service = buildNoopChatbotService(new MockSmartbotClient());
    const result = await service.sendMessage(
      {
        id: '2e2031e8-bd75-4d93-9b7a-78a8f31f4e22',
        email: 'student@example.com',
        role: Role.officer,
        fullName: 'Demo Student',
        studentCode: null,
        className: null,
        faculty: null,
        avatarUrl: null,
        workspaceId: null,
        workspace: null,
      },
      { text: 'Hỏi cán bộ phụ trách', contextScope: 'student_helpdesk' },
    );

    expect(result.handoffRequired).toBe(true);
    expect(result.messages[0]).toMatchObject({
      type: 'action_cards',
      title: 'Tạo yêu cầu hỗ trợ cán bộ',
      items: [expect.objectContaining({ type: 'handoff', title: 'Cần cán bộ xác minh' })],
    });
  });

  it('returns school demo upload navigate action', async () => {
    const service = buildNoopChatbotService(new MockSmartbotClient());
    const result = await service.sendMessage(
      {
        id: '2e2031e8-bd75-4d93-9b7a-78a8f31f4e22',
        email: 'student@example.com',
        role: Role.officer,
        fullName: 'Demo Student',
        studentCode: null,
        className: null,
        faculty: null,
        avatarUrl: null,
        workspaceId: null,
        workspace: null,
      },
      { text: 'Upload minh chứng thể lực', contextScope: 'student_helpdesk' },
    );

    expect(result.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Upload minh chứng thể lực',
          type: 'navigate',
          route: '/app/evidence',
          query: { criterion: 'physical', action: 'upload' },
        }),
      ]),
    );
  });

  it('calls Smartbot/mock for school-level criteria questions with safe metadata', async () => {
    const client = new CapturingSmartbotClient();
    const service = buildNoopChatbotService(client);
    const result = await service.sendMessage(
      {
        id: '2e2031e8-bd75-4d93-9b7a-78a8f31f4e22',
        email: 'student@example.com',
        role: Role.officer,
        fullName: 'Demo Student',
        studentCode: null,
        className: null,
        faculty: null,
        avatarUrl: null,
        workspaceId: null,
        workspace: null,
      },
      {
        text: 'Cấp Trường cần tiêu chí tình nguyện gì?',
        contextScope: 'student_helpdesk',
        pageContext: { page: 'dashboard' },
      },
    );

    const variables = Object.fromEntries(
      client.lastRequest!.metadata.button_variables.map((item) => [item.variableName, item.value]),
    );
    expect(result.answer).toContain('tiêu chí Tình nguyện tốt');
    expect(variables).toMatchObject({
      role: 'student',
      context_scope: 'student_helpdesk',
      current_page: 'dashboard',
      target_level: 'school',
      application_status: 'prechecked',
      missing_summary: 'Thiếu minh chứng Thể lực tốt; Tình nguyện mới ghi nhận 1/2 ngày',
      deadline_summary: 'Hạn nộp/bổ sung demo: 30/10',
      next_action: 'Tìm minh chứng tình nguyện hoặc upload minh chứng thể lực',
    });
    expect(JSON.stringify(variables)).not.toContain('student@example.com');
  });

  it('uses local school criteria fallback when criteria RAG Smartbot call fails', async () => {
    const service = buildNoopChatbotService(new FailingSmartbotClient());
    const result = await service.sendMessage(
      {
        id: '2e2031e8-bd75-4d93-9b7a-78a8f31f4e22',
        email: 'student@example.com',
        role: Role.officer,
        fullName: 'Demo Student',
        studentCode: null,
        className: null,
        faculty: null,
        avatarUrl: null,
        workspaceId: null,
        workspace: null,
      },
      {
        text: 'tiêu chí của sinh viên 5 tốt cấp trường',
        contextScope: 'student_helpdesk',
        pageContext: { page: 'dashboard' },
      },
    );

    expect(result.answer).toContain('Trong bản demo cấp Trường, hồ sơ Sinh viên 5 tốt cần đáp ứng 5 nhóm tiêu chí');
    expect(result.answer).toContain('Hệ thống chỉ hỗ trợ tiền kiểm và giải thích.');
    expect(result.answer).not.toContain('Mình chưa thể kết nối trợ lý hội thoại ngay lúc này');
  });

  it('uses generic fallback only when no local tool or criteria RAG matched and Smartbot fails', async () => {
    const service = buildNoopChatbotService(new FailingSmartbotClient());
    const result = await service.sendMessage(
      {
        id: '2e2031e8-bd75-4d93-9b7a-78a8f31f4e22',
        email: 'student@example.com',
        role: Role.officer,
        fullName: 'Demo Student',
        studentCode: null,
        className: null,
        faculty: null,
        avatarUrl: null,
        workspaceId: null,
        workspace: null,
      },
      {
        text: 'Bạn có thể hỗ trợ gì?',
        contextScope: 'student_helpdesk',
        pageContext: { page: 'dashboard' },
      },
    );

    expect(result.answer).toContain('Mình chưa thể kết nối trợ lý hội thoại ngay lúc này');
  });
});

class CapturingSmartbotClient implements SmartbotClient {
  lastRequest?: SmartbotConversationRequest;

  async sendMessage(input: SmartbotConversationRequest): Promise<unknown> {
    this.lastRequest = input;
    return new MockSmartbotClient().sendMessage(input);
  }
}

class FailingSmartbotClient implements SmartbotClient {
  async sendMessage(): Promise<unknown> {
    throw new AppError(504, ErrorCodes.SMARTBOT_TIMEOUT, ErrorCodes.SMARTBOT_TIMEOUT);
  }
}

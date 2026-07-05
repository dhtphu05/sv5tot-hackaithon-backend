import type { ChatbotAction } from './chatbot.types';

export class ChatbotHandoffService {
  buildHandoffAction(): ChatbotAction {
    return {
      id: 'act_handoff_create_support_request',
      label: 'Tạo yêu cầu hỗ trợ cán bộ',
      type: 'postback',
      actionType: 'postback',
      payload: 'fivetot://action/create_support_request',
      requiresConfirmation: false,
    };
  }
}

import type {
  SmartbotClient,
  SmartbotConversationRequest,
} from '../../modules/chatbot/chatbot.types';

export class MockSmartbotClient implements SmartbotClient {
  async sendMessage(input: SmartbotConversationRequest): Promise<unknown> {
    const text = input.text.toLowerCase();
    if (text.includes('chuyển') || text.includes('cán bộ') || text.includes('handoff')) {
      return response(input.session_id, [
        {
          type: 'chuyen_gdv',
          text: 'Mình sẽ tạo yêu cầu để cán bộ phụ trách hỗ trợ thêm. Hệ thống chỉ hỗ trợ tiền kiểm và giải thích. Kết quả chính thức do cán bộ/Hội đồng xác nhận.',
        },
      ]);
    }
    if (text.includes('matching') || text.includes('tìm minh chứng') || text.includes('kho sự kiện')) {
      return response(input.session_id, [
        {
          type: 'text',
          text: 'Mình sẽ tìm trong Matching Hub các minh chứng demo phù hợp cấp Trường, ví dụ Mùa hè xanh 2025 hoặc Hiến máu nhân đạo đợt 1.',
        },
      ]);
    }
    if (text.includes('carousel') || text.includes('minh chứng hợp lệ')) {
      return response(input.session_id, [
        {
          type: 'carousel',
          text: 'Một số hướng xử lý phù hợp:',
          items: [
            {
              title: 'Upload minh chứng',
              subtitle: 'Bổ sung file cho tiêu chí đang thiếu.',
              buttons: [{ type: 'postback', title: 'Upload ngay', payload: 'fivetot://action/upload_evidence' }],
            },
            {
              title: 'Matching Hub',
              subtitle: 'Tìm sự kiện đã có danh sách chính thức.',
              buttons: [{ type: 'postback', title: 'Tìm sự kiện', payload: 'fivetot://action/search_matching_hub' }],
            },
          ],
        },
      ]);
    }
    if (text.includes('thiếu') || text.includes('gap')) {
      return response(input.session_id, [
        {
          type: 'quickreply',
          text: 'Hồ sơ cấp Trường còn cần xử lý minh chứng Thể lực tốt và kiểm tra thêm Tình nguyện tốt. Hệ thống chỉ hỗ trợ tiền kiểm và giải thích. Kết quả chính thức do cán bộ/Hội đồng xác nhận.',
          buttons: [
            { type: 'postback', title: 'Xem hồ sơ còn thiếu gì', payload: 'fivetot://action/get_missing_items' },
            { type: 'postback', title: 'Tìm minh chứng tình nguyện', payload: 'Tìm minh chứng tình nguyện' },
          ],
        },
      ]);
    }

    return response(input.session_id, [
      {
        type: 'text',
        text: 'Ở demo cấp Trường, tiêu chí Tình nguyện tốt thường cần đủ số ngày hoạt động hoặc minh chứng tương đương theo quy định. Mình có thể giải thích tiêu chí và gợi ý minh chứng, không chốt kết quả chính thức.',
      },
    ]);
  }
}

function response(sessionId: string, cardData: unknown[]) {
  return {
    object: {
      sb: {
        session_id: sessionId,
        intent_name: 'mock_smartbot',
        card_data: cardData,
        card_data_info: { status: 0 },
      },
    },
  };
}

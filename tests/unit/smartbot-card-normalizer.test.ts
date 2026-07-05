import { describe, expect, it } from 'vitest';
import { normalizeSmartbotResponse } from '../../src/modules/chatbot/smartbot-card.normalizer';

describe('normalizeSmartbotResponse', () => {
  it('normalizes text, quickreply, image, carousel, handoff, and unknown cards', () => {
    const result = normalizeSmartbotResponse({
      sessionId: 's1',
      fallbackText: 'fallback',
      raw: {
        object: {
          sb: {
            intent_name: 'demo',
            card_data_info: { status: 2 },
            card_data: [
              { type: 'text', text: 'Xin chào' },
              {
                type: 'quickreply',
                text: 'Chọn thao tác',
                buttons: [{ type: 'postback', title: 'Tiền kiểm', payload: 'fivetot://action/run_precheck' }],
              },
              { type: 'image', title: 'Mẫu', image_url: 'https://example.com/a.png' },
              { type: 'carousel', items: [{ title: 'Upload', buttons: [{ title: 'Upload', payload: 'upload' }] }] },
              { type: 'chuyen_gdv', text: 'Chuyển cán bộ' },
              { type: 'other', title: 'Khác' },
            ],
          },
        },
      },
    });

    expect(result.smartbot).toMatchObject({ intentName: 'demo', status: 2 });
    expect(result.messages.map((message) => message.type)).toEqual([
      'text',
      'quickreply',
      'image',
      'carousel',
      'handoff',
      'unknown',
    ]);
    expect(result.handoffRequired).toBe(true);
    expect(result.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actionType: 'internal_action' }),
        expect.objectContaining({ label: 'Tạo yêu cầu hỗ trợ cán bộ' }),
      ]),
    );
  });
});

import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';

const app = createApp();

describe('POST /api/chatbot/message', () => {
  it('requires authentication', async () => {
    const response = await request(app)
      .post('/api/chatbot/message')
      .send({ text: 'Hồ sơ em còn thiếu gì?' })
      .expect(401);

    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'UNAUTHORIZED' },
    });
  });
});

describe('POST /api/chatbot/stream', () => {
  it('requires authentication', async () => {
    const response = await request(app)
      .post('/api/chatbot/stream')
      .send({ text: 'Cấp Trường cần tiêu chí tình nguyện gì?' })
      .expect(401);

    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'UNAUTHORIZED' },
    });
  });
});

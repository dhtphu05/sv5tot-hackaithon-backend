import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';

describe('retired backend AI placeholder routes', () => {
  it('does not expose unconsumed AI, SmartUX, or internal SmartReader test routes', async () => {
    const app = createApp();

    const aiPlaceholder = await request(app).post('/api/ai/chatbot/message').send({});
    const smartUx = await request(app).post('/api/smartux/events').send({});
    const smartReader = await request(app).post('/api/internal/smartreader/upload-test');

    expect(aiPlaceholder.status).toBe(404);
    expect(smartUx.status).toBe(404);
    expect(smartReader.status).toBe(404);
  });

  it('keeps the consumed chatbot API mounted', async () => {
    const response = await request(createApp()).post('/api/chatbot/message').send({});

    expect(response.status).toBe(401);
  });
});

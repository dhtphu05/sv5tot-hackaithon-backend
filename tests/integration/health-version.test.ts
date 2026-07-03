import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';

const app = createApp();

describe('foundation routes', () => {
  it('returns health status', async () => {
    const response = await request(app).get('/health').expect(200);

    expect(response.body).toMatchObject({
      success: true,
      data: {
        status: 'ok',
      },
      error: null,
    });
    expect(response.body.data.uptime).toEqual(expect.any(Number));
    expect(response.body.data.timestamp).toEqual(expect.any(String));
    expect(response.body.meta.requestId).toEqual(expect.any(String));
  });

  it('returns API version metadata', async () => {
    const response = await request(app).get('/api/version').expect(200);

    expect(response.body).toMatchObject({
      success: true,
      data: {
        name: '5TOT Backend API',
        version: '0.2.0',
        environment: 'test',
      },
      error: null,
    });
    expect(response.body.meta.requestId).toEqual(expect.any(String));
  });

  it('rejects /api/me without a bearer token', async () => {
    const response = await request(app).get('/api/me').expect(401);

    expect(response.body).toMatchObject({
      success: false,
      data: null,
      error: {
        code: 'UNAUTHORIZED',
      },
    });
    expect(response.body.meta.requestId).toEqual(expect.any(String));
  });

  it('returns a validation error for malformed JSON bodies', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{email')
      .expect(400);

    expect(response.body).toMatchObject({
      success: false,
      data: null,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid JSON payload',
      },
    });
    expect(response.body.meta.requestId).toEqual(expect.any(String));
  });
});

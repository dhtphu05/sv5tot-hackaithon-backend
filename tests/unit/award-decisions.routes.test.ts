import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';

describe('Award Decision routes', () => {
  it('requires authentication on the registry endpoint', async () => {
    const response = await request(createApp()).get('/api/award-decisions');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });
});

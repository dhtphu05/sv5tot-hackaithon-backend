import { describe, expect, it } from 'vitest';
import { isAllowedOrigin } from '../../src/config/cors';

describe('cors origin matching', () => {
  it('allows configured origins exactly', () => {
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true);
  });

  it('allows equivalent loopback hostnames on the same configured dev port', () => {
    expect(isAllowedOrigin('http://127.0.0.1:5173')).toBe(true);
  });

  it('does not allow unconfigured external origins', () => {
    expect(isAllowedOrigin('http://example.com:5173')).toBe(false);
  });
});

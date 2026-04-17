import { describe, it, expect } from 'vitest';
import { PortalLoginBody } from '../../src/validators/portal.schema.js';

describe('PortalLoginBody', () => {
  it('accepts valid email + apiKey', () => {
    const result = PortalLoginBody.safeParse({ email: 'user@example.com', apiKey: 'x402_abc' });
    expect(result.success).toBe(true);
    expect(result.data.email).toBe('user@example.com');
    expect(result.data.apiKey).toBe('x402_abc');
  });

  it('rejects missing email', () => {
    const result = PortalLoginBody.safeParse({ apiKey: 'x402_abc' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email', () => {
    const result = PortalLoginBody.safeParse({ email: 'notanemail', apiKey: 'x402_abc' });
    expect(result.success).toBe(false);
  });

  it('rejects missing apiKey', () => {
    const result = PortalLoginBody.safeParse({ email: 'user@example.com' });
    expect(result.success).toBe(false);
  });

  it('rejects empty apiKey', () => {
    const result = PortalLoginBody.safeParse({ email: 'user@example.com', apiKey: '' });
    expect(result.success).toBe(false);
  });

  it('rejects email exceeding 320 chars', () => {
    const longEmail = 'a'.repeat(310) + '@example.com';
    const result = PortalLoginBody.safeParse({ email: longEmail, apiKey: 'x402_abc' });
    expect(result.success).toBe(false);
  });

  it('rejects apiKey exceeding 256 chars', () => {
    const result = PortalLoginBody.safeParse({
      email: 'user@example.com',
      apiKey: 'x'.repeat(257),
    });
    expect(result.success).toBe(false);
  });

  it('accepts apiKey at max length', () => {
    const result = PortalLoginBody.safeParse({
      email: 'user@example.com',
      apiKey: 'x'.repeat(256),
    });
    expect(result.success).toBe(true);
  });
});

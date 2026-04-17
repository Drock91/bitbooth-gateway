import { describe, it, expect } from 'vitest';
import { DemoSignupInput } from '../../src/validators/demo.schema.js';

describe('demo.schema', () => {
  describe('DemoSignupInput', () => {
    it('accepts a valid email', () => {
      const res = DemoSignupInput.safeParse({ email: 'user@example.com' });
      expect(res.success).toBe(true);
      expect(res.data.email).toBe('user@example.com');
    });

    it('trims whitespace around email', () => {
      const res = DemoSignupInput.safeParse({ email: '  user@example.com  ' });
      expect(res.success).toBe(true);
      expect(res.data.email).toBe('user@example.com');
    });

    it('rejects missing email', () => {
      const res = DemoSignupInput.safeParse({});
      expect(res.success).toBe(false);
    });

    it('rejects empty string', () => {
      const res = DemoSignupInput.safeParse({ email: '' });
      expect(res.success).toBe(false);
    });

    it('rejects non-email strings', () => {
      const res = DemoSignupInput.safeParse({ email: 'not-an-email' });
      expect(res.success).toBe(false);
    });

    it('rejects emails missing @', () => {
      const res = DemoSignupInput.safeParse({ email: 'user.example.com' });
      expect(res.success).toBe(false);
    });

    it('rejects emails missing domain', () => {
      const res = DemoSignupInput.safeParse({ email: 'user@' });
      expect(res.success).toBe(false);
    });

    it('rejects emails exceeding 254 chars', () => {
      const long = 'a'.repeat(250) + '@x.co';
      const res = DemoSignupInput.safeParse({ email: long });
      expect(res.success).toBe(false);
    });

    it('accepts emails at max length', () => {
      const atMax = 'a'.repeat(244) + '@x.co'; // 244 + 5 = 249 ≤ 254
      const res = DemoSignupInput.safeParse({ email: atMax });
      expect(res.success).toBe(true);
    });

    it('rejects non-object input', () => {
      expect(DemoSignupInput.safeParse(null).success).toBe(false);
      expect(DemoSignupInput.safeParse('string').success).toBe(false);
    });

    it('rejects non-string email types', () => {
      expect(DemoSignupInput.safeParse({ email: 42 }).success).toBe(false);
      expect(DemoSignupInput.safeParse({ email: null }).success).toBe(false);
    });
  });
});

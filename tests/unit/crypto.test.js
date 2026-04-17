import { describe, it, expect } from 'vitest';
import { hmacSha256, safeEquals, sha256, newNonce } from '../../src/lib/crypto.js';
import { createHmac, createHash } from 'node:crypto';

describe('lib/crypto', () => {
  describe('hmacSha256', () => {
    it('returns correct HMAC-SHA256 hex digest', () => {
      const key = 'test-key';
      const body = 'hello world';
      const expected = createHmac('sha256', key).update(body).digest('hex');
      expect(hmacSha256(key, body)).toBe(expected);
    });

    it('returns different digests for different keys', () => {
      const body = 'same-body';
      const a = hmacSha256('key-a', body);
      const b = hmacSha256('key-b', body);
      expect(a).not.toBe(b);
    });

    it('returns different digests for different bodies', () => {
      const key = 'same-key';
      const a = hmacSha256(key, 'body-a');
      const b = hmacSha256(key, 'body-b');
      expect(a).not.toBe(b);
    });

    it('produces 64-char hex string', () => {
      const result = hmacSha256('k', 'b');
      expect(result).toMatch(/^[0-9a-f]{64}$/);
    });

    it('handles empty body', () => {
      const result = hmacSha256('key', '');
      expect(result).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('safeEquals', () => {
    it('returns true for identical strings', () => {
      expect(safeEquals('abc', 'abc')).toBe(true);
    });

    it('returns false for different strings of same length', () => {
      expect(safeEquals('abc', 'abd')).toBe(false);
    });

    it('returns false for different lengths', () => {
      expect(safeEquals('short', 'longer-string')).toBe(false);
    });

    it('returns true for empty strings', () => {
      expect(safeEquals('', '')).toBe(true);
    });

    it('returns false when first is prefix of second', () => {
      expect(safeEquals('abc', 'abcd')).toBe(false);
    });

    it('handles hex digest comparison', () => {
      const digest = hmacSha256('k', 'b');
      expect(safeEquals(digest, digest)).toBe(true);
      const other = hmacSha256('k', 'c');
      expect(safeEquals(digest, other)).toBe(false);
    });
  });

  describe('sha256', () => {
    it('returns correct SHA-256 hex digest', () => {
      const input = 'hello';
      const expected = createHash('sha256').update(input).digest('hex');
      expect(sha256(input)).toBe(expected);
    });

    it('produces 64-char hex string', () => {
      expect(sha256('test')).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is deterministic', () => {
      expect(sha256('same')).toBe(sha256('same'));
    });

    it('handles empty input', () => {
      const result = sha256('');
      expect(result).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('newNonce', () => {
    it('returns 32-char hex string (16 bytes)', () => {
      expect(newNonce()).toMatch(/^[0-9a-f]{32}$/);
    });

    it('produces unique values', () => {
      const nonces = new Set(Array.from({ length: 50 }, () => newNonce()));
      expect(nonces.size).toBe(50);
    });
  });
});

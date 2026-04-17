import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withRetry, isRetryable, computeDelay } from '../../src/adapters/retry.js';
import {
  UpstreamError,
  ValidationError,
  UnauthorizedError,
  NotFoundError,
} from '../../src/lib/errors.js';

describe('adapters/retry', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('isRetryable', () => {
    it('returns true for generic UpstreamError', () => {
      expect(isRetryable(new UpstreamError('chain', { reason: 'timeout' }))).toBe(true);
    });

    it('returns true for UpstreamError with timeout reason', () => {
      expect(isRetryable(new UpstreamError('http', { reason: 'timeout', url: 'x' }))).toBe(true);
    });

    it('returns true for UpstreamError with tx-not-found reason', () => {
      expect(isRetryable(new UpstreamError('chain', { reason: 'tx-not-found' }))).toBe(true);
    });

    it('returns false for UpstreamError with not-configured reason', () => {
      expect(isRetryable(new UpstreamError('exchange', { reason: 'not-configured' }))).toBe(false);
    });

    it('returns false for UpstreamError with no-rpc-url reason', () => {
      expect(isRetryable(new UpstreamError('chain', { reason: 'no-rpc-url' }))).toBe(false);
    });

    it('returns true for AbortError', () => {
      const err = new DOMException('aborted', 'AbortError');
      expect(isRetryable(err)).toBe(true);
    });

    it('returns true for ECONNRESET', () => {
      const err = new Error('reset');
      err.code = 'ECONNRESET';
      expect(isRetryable(err)).toBe(true);
    });

    it('returns true for ECONNREFUSED', () => {
      const err = new Error('refused');
      err.code = 'ECONNREFUSED';
      expect(isRetryable(err)).toBe(true);
    });

    it('returns true for ETIMEDOUT', () => {
      const err = new Error('timed out');
      err.code = 'ETIMEDOUT';
      expect(isRetryable(err)).toBe(true);
    });

    it('returns true for UND_ERR_CONNECT_TIMEOUT', () => {
      const err = new Error('connect timeout');
      err.code = 'UND_ERR_CONNECT_TIMEOUT';
      expect(isRetryable(err)).toBe(true);
    });

    it('returns true for EPIPE', () => {
      const err = new Error('broken pipe');
      err.code = 'EPIPE';
      expect(isRetryable(err)).toBe(true);
    });

    it('returns true for SERVER_ERROR (ethers)', () => {
      const err = new Error('server error');
      err.code = 'SERVER_ERROR';
      expect(isRetryable(err)).toBe(true);
    });

    it('returns false for ValidationError', () => {
      expect(isRetryable(new ValidationError([]))).toBe(false);
    });

    it('returns false for UnauthorizedError', () => {
      expect(isRetryable(new UnauthorizedError())).toBe(false);
    });

    it('returns false for NotFoundError', () => {
      expect(isRetryable(new NotFoundError('x'))).toBe(false);
    });

    it('returns false for generic Error', () => {
      expect(isRetryable(new Error('oops'))).toBe(false);
    });

    it('returns false for null', () => {
      expect(isRetryable(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isRetryable(undefined)).toBe(false);
    });

    it('returns true for UpstreamError with no details', () => {
      expect(isRetryable(new UpstreamError('svc'))).toBe(true);
    });
  });

  describe('computeDelay', () => {
    it('returns a number >= 0 for attempt 0', () => {
      const d = computeDelay(0, 200, 5000);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(200);
    });

    it('caps at maxDelayMs', () => {
      for (let i = 0; i < 100; i++) {
        expect(computeDelay(20, 200, 1000)).toBeLessThanOrEqual(1000);
      }
    });

    it('returns integer values', () => {
      const d = computeDelay(2, 200, 5000);
      expect(Number.isInteger(d)).toBe(true);
    });

    it('grows exponentially before cap', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const d0 = computeDelay(0, 100, 100000);
      const d2 = computeDelay(2, 100, 100000);
      expect(d2).toBeGreaterThan(d0);
    });

    it('returns 0 when random is 0', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      expect(computeDelay(3, 200, 5000)).toBe(0);
    });
  });

  describe('withRetry', () => {
    it('returns value on first success', async () => {
      const fn = vi.fn().mockResolvedValue('ok');
      const result = await withRetry(fn);
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledOnce();
    });

    it('retries on retryable error and succeeds', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new UpstreamError('http', { reason: 'timeout' }))
        .mockResolvedValueOnce('recovered');
      vi.spyOn(Math, 'random').mockReturnValue(0);

      const result = await withRetry(fn, { baseDelayMs: 1, maxDelayMs: 1 });
      expect(result).toBe('recovered');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('throws immediately on non-retryable error', async () => {
      const fn = vi.fn().mockRejectedValue(new ValidationError([]));
      await expect(withRetry(fn)).rejects.toThrow('Invalid request');
      expect(fn).toHaveBeenCalledOnce();
    });

    it('throws after maxAttempts exhausted', async () => {
      const err = new UpstreamError('chain', { reason: 'timeout' });
      const fn = vi.fn().mockRejectedValue(err);
      vi.spyOn(Math, 'random').mockReturnValue(0);

      await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })).rejects.toThrow(err);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('uses custom isRetryable predicate', async () => {
      const fn = vi.fn().mockRejectedValueOnce(new Error('custom')).mockResolvedValueOnce('ok');
      vi.spyOn(Math, 'random').mockReturnValue(0);

      const result = await withRetry(fn, {
        isRetryable: () => true,
        baseDelayMs: 1,
      });
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('defaults to 3 maxAttempts', async () => {
      const fn = vi.fn().mockRejectedValue(new UpstreamError('x', {}));
      vi.spyOn(Math, 'random').mockReturnValue(0);

      await expect(withRetry(fn, { baseDelayMs: 1 })).rejects.toThrow();
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('retries ECONNRESET errors', async () => {
      const err = new Error('connection reset');
      err.code = 'ECONNRESET';
      const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce('ok');
      vi.spyOn(Math, 'random').mockReturnValue(0);

      const result = await withRetry(fn, { baseDelayMs: 1 });
      expect(result).toBe('ok');
    });

    it('respects maxAttempts = 1 (no retry)', async () => {
      const fn = vi.fn().mockRejectedValue(new UpstreamError('x', {}));
      await expect(withRetry(fn, { maxAttempts: 1 })).rejects.toThrow();
      expect(fn).toHaveBeenCalledOnce();
    });

    it('waits between retries', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new UpstreamError('x', {}))
        .mockResolvedValueOnce('ok');
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

      await withRetry(fn, { baseDelayMs: 100, maxDelayMs: 5000 });
      const retryCalls = setTimeoutSpy.mock.calls.filter(
        ([, ms]) => typeof ms === 'number' && ms > 0,
      );
      expect(retryCalls.length).toBeGreaterThanOrEqual(1);
      setTimeoutSpy.mockRestore();
    });

    it('does not retry not-configured upstream errors', async () => {
      const fn = vi
        .fn()
        .mockRejectedValue(new UpstreamError('exchange', { reason: 'not-configured' }));
      await expect(withRetry(fn)).rejects.toThrow();
      expect(fn).toHaveBeenCalledOnce();
    });

    it('preserves the original error on final throw', async () => {
      const original = new UpstreamError('chain', { reason: 'timeout', txHash: '0xabc' });
      const fn = vi.fn().mockRejectedValue(original);
      vi.spyOn(Math, 'random').mockReturnValue(0);

      try {
        await withRetry(fn, { maxAttempts: 2, baseDelayMs: 1 });
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBe(original);
        expect(err.details.txHash).toBe('0xabc');
      }
    });

    it('succeeds on last attempt', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new UpstreamError('x', {}))
        .mockRejectedValueOnce(new UpstreamError('x', {}))
        .mockResolvedValueOnce('last-chance');
      vi.spyOn(Math, 'random').mockReturnValue(0);

      const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });
      expect(result).toBe('last-chance');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('skips delay when computeDelay returns 0', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new UpstreamError('x', {}))
        .mockResolvedValueOnce('ok');
      vi.spyOn(Math, 'random').mockReturnValue(0);

      const start = Date.now();
      await withRetry(fn, { baseDelayMs: 100, maxDelayMs: 5000 });
      expect(Date.now() - start).toBeLessThan(50);
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/repositories/rate-limit.repo.js', () => ({
  rateLimitRepo: { consume: vi.fn() },
}));

vi.mock('../../src/repositories/usage.repo.js', () => ({
  usageRepo: { getForPeriod: vi.fn() },
}));

import {
  enforceRateLimit,
  enforceSignupRateLimit,
  enforceAdminRateLimit,
  enforceHealthRateLimit,
  enforceMonthlyQuota,
  extractClientIp,
  PLAN_LIMITS,
  MONTHLY_QUOTAS,
  rateLimitHeaders,
} from '../../src/middleware/rate-limit.middleware.js';
import { rateLimitRepo } from '../../src/repositories/rate-limit.repo.js';
import { usageRepo } from '../../src/repositories/usage.repo.js';
import { TooManyRequestsError, QuotaExceededError } from '../../src/lib/errors.js';

const ACC = '550e8400-e29b-41d4-a716-446655440000';

describe('rate-limit.middleware', () => {
  beforeEach(() => {
    vi.mocked(rateLimitRepo.consume).mockReset();
  });

  describe('PLAN_LIMITS', () => {
    it('defines limits for all plan tiers', () => {
      expect(PLAN_LIMITS).toHaveProperty('free');
      expect(PLAN_LIMITS).toHaveProperty('starter');
      expect(PLAN_LIMITS).toHaveProperty('growth');
      expect(PLAN_LIMITS).toHaveProperty('scale');
    });

    it('free tier has capacity 10', () => {
      expect(PLAN_LIMITS.free.capacity).toBe(10);
    });

    it('scale tier has highest capacity', () => {
      expect(PLAN_LIMITS.scale.capacity).toBeGreaterThan(PLAN_LIMITS.growth.capacity);
      expect(PLAN_LIMITS.growth.capacity).toBeGreaterThan(PLAN_LIMITS.starter.capacity);
      expect(PLAN_LIMITS.starter.capacity).toBeGreaterThan(PLAN_LIMITS.free.capacity);
    });
  });

  describe('rateLimitHeaders', () => {
    it('returns standard ratelimit-* headers as strings', () => {
      const headers = rateLimitHeaders({ limit: 100, remaining: 42, reset: 2 });
      expect(headers).toEqual({
        'ratelimit-limit': '100',
        'ratelimit-remaining': '42',
        'ratelimit-reset': '2',
      });
    });

    it('handles zero remaining', () => {
      const headers = rateLimitHeaders({ limit: 10, remaining: 0, reset: 6 });
      expect(headers['ratelimit-remaining']).toBe('0');
    });
  });

  describe('enforceRateLimit', () => {
    it('returns rate limit info when tokens are available', async () => {
      const bucket = { accountId: ACC, tokens: 9, capacity: 10, refillRate: 0.1667 };
      vi.mocked(rateLimitRepo.consume).mockResolvedValueOnce(bucket);

      const result = await enforceRateLimit(ACC, 'free');
      expect(result).toEqual({ limit: 10, remaining: 9, reset: 6 });
      expect(rateLimitRepo.consume).toHaveBeenCalledWith(ACC, 10, PLAN_LIMITS.free.refillRate);
    });

    it('floors remaining tokens to integer', async () => {
      const bucket = { accountId: ACC, tokens: 4.7, capacity: 10, refillRate: 0.1667 };
      vi.mocked(rateLimitRepo.consume).mockResolvedValueOnce(bucket);

      const result = await enforceRateLimit(ACC, 'free');
      expect(result.remaining).toBe(4);
    });

    it('throws TooManyRequestsError when no tokens (consume returns null)', async () => {
      vi.mocked(rateLimitRepo.consume).mockResolvedValueOnce(null);

      await expect(enforceRateLimit(ACC, 'free')).rejects.toThrow(TooManyRequestsError);
    });

    it('includes retryAfter and limit in TooManyRequestsError', async () => {
      vi.mocked(rateLimitRepo.consume).mockResolvedValueOnce(null);

      try {
        await enforceRateLimit(ACC, 'free');
      } catch (err) {
        expect(err).toBeInstanceOf(TooManyRequestsError);
        expect(err.retryAfter).toBeGreaterThan(0);
        expect(err.limit).toBe(10);
        expect(err.status).toBe(429);
      }
    });

    it('treats ConditionalCheckFailedException as rate limited', async () => {
      const err = new Error('condition failed');
      err.name = 'ConditionalCheckFailedException';
      vi.mocked(rateLimitRepo.consume).mockRejectedValueOnce(err);

      await expect(enforceRateLimit(ACC, 'starter')).rejects.toThrow(TooManyRequestsError);
    });

    it('uses correct limits for each plan', async () => {
      vi.mocked(rateLimitRepo.consume).mockResolvedValue({ tokens: 1 });

      const result = await enforceRateLimit(ACC, 'growth');
      expect(rateLimitRepo.consume).toHaveBeenCalledWith(
        ACC,
        PLAN_LIMITS.growth.capacity,
        PLAN_LIMITS.growth.refillRate,
      );
      expect(result.limit).toBe(500);
    });

    it('defaults to free plan for unknown plan values', async () => {
      vi.mocked(rateLimitRepo.consume).mockResolvedValue({ tokens: 1 });

      const result = await enforceRateLimit(ACC, 'nonexistent');
      expect(rateLimitRepo.consume).toHaveBeenCalledWith(
        ACC,
        PLAN_LIMITS.free.capacity,
        PLAN_LIMITS.free.refillRate,
      );
      expect(result.limit).toBe(10);
    });

    it('propagates non-rate-limit errors', async () => {
      vi.mocked(rateLimitRepo.consume).mockRejectedValueOnce(new Error('DDB down'));

      await expect(enforceRateLimit(ACC, 'free')).rejects.toThrow('DDB down');
    });

    it('calls consume with scale plan limits', async () => {
      vi.mocked(rateLimitRepo.consume).mockResolvedValue({ tokens: 1999 });

      await enforceRateLimit(ACC, 'scale');
      expect(rateLimitRepo.consume).toHaveBeenCalledWith(ACC, 2000, PLAN_LIMITS.scale.refillRate);
    });
  });

  describe('extractClientIp', () => {
    it('extracts IP from requestContext.identity.sourceIp', () => {
      const event = { requestContext: { identity: { sourceIp: '1.2.3.4' } } };
      expect(extractClientIp(event)).toBe('1.2.3.4');
    });

    it('falls back to x-forwarded-for header', () => {
      const event = { headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' } };
      expect(extractClientIp(event)).toBe('10.0.0.1');
    });

    it('trims whitespace from x-forwarded-for', () => {
      const event = { headers: { 'x-forwarded-for': '  9.8.7.6 , 1.1.1.1' } };
      expect(extractClientIp(event)).toBe('9.8.7.6');
    });

    it('prefers sourceIp over x-forwarded-for', () => {
      const event = {
        requestContext: { identity: { sourceIp: '1.1.1.1' } },
        headers: { 'x-forwarded-for': '2.2.2.2' },
      };
      expect(extractClientIp(event)).toBe('1.1.1.1');
    });

    it('returns "unknown" when no IP info available', () => {
      expect(extractClientIp({})).toBe('unknown');
    });

    it('returns "unknown" for null event', () => {
      expect(extractClientIp(null)).toBe('unknown');
    });

    it('returns "unknown" for undefined event', () => {
      expect(extractClientIp(undefined)).toBe('unknown');
    });
  });

  describe('enforceSignupRateLimit', () => {
    it('calls consume with signup#<ip> key and signup limits', async () => {
      vi.mocked(rateLimitRepo.consume).mockResolvedValueOnce({ tokens: 4, capacity: 5 });

      const result = await enforceSignupRateLimit('1.2.3.4');
      expect(rateLimitRepo.consume).toHaveBeenCalledWith(
        'signup#1.2.3.4',
        5,
        expect.closeTo(5 / 3600, 5),
      );
      expect(result.limit).toBe(5);
      expect(result.remaining).toBe(4);
      expect(result.reset).toBe(Math.ceil(1 / (5 / 3600)));
    });

    it('throws TooManyRequestsError when no tokens', async () => {
      vi.mocked(rateLimitRepo.consume).mockResolvedValueOnce(null);

      await expect(enforceSignupRateLimit('5.6.7.8')).rejects.toThrow(TooManyRequestsError);
    });

    it('treats ConditionalCheckFailedException as rate limited', async () => {
      const err = new Error('condition failed');
      err.name = 'ConditionalCheckFailedException';
      vi.mocked(rateLimitRepo.consume).mockRejectedValueOnce(err);

      await expect(enforceSignupRateLimit('5.6.7.8')).rejects.toThrow(TooManyRequestsError);
    });

    it('propagates non-rate-limit errors', async () => {
      vi.mocked(rateLimitRepo.consume).mockRejectedValueOnce(new Error('DDB down'));

      await expect(enforceSignupRateLimit('1.2.3.4')).rejects.toThrow('DDB down');
    });

    it('floors remaining tokens to integer', async () => {
      vi.mocked(rateLimitRepo.consume).mockResolvedValueOnce({ tokens: 3.7, capacity: 5 });

      const result = await enforceSignupRateLimit('1.2.3.4');
      expect(result.remaining).toBe(3);
    });

    it('includes retryAfter and limit in TooManyRequestsError', async () => {
      vi.mocked(rateLimitRepo.consume).mockResolvedValueOnce(null);

      try {
        await enforceSignupRateLimit('1.2.3.4');
      } catch (err) {
        expect(err).toBeInstanceOf(TooManyRequestsError);
        expect(err.retryAfter).toBeGreaterThan(0);
        expect(err.limit).toBe(5);
      }
    });
  });
  describe('enforceAdminRateLimit', () => {
    it('calls consume with admin#<ip> key and admin limits', async () => {
      vi.mocked(rateLimitRepo.consume).mockResolvedValueOnce({ tokens: 29, capacity: 30 });

      const result = await enforceAdminRateLimit('10.0.0.1');
      expect(rateLimitRepo.consume).toHaveBeenCalledWith(
        'admin#10.0.0.1',
        30,
        expect.closeTo(30 / 3600, 5),
      );
      expect(result.limit).toBe(30);
      expect(result.remaining).toBe(29);
      expect(result.reset).toBe(Math.ceil(1 / (30 / 3600)));
    });

    it('throws TooManyRequestsError when no tokens', async () => {
      vi.mocked(rateLimitRepo.consume).mockResolvedValueOnce(null);

      await expect(enforceAdminRateLimit('5.6.7.8')).rejects.toThrow(TooManyRequestsError);
    });

    it('treats ConditionalCheckFailedException as rate limited', async () => {
      const err = new Error('condition failed');
      err.name = 'ConditionalCheckFailedException';
      vi.mocked(rateLimitRepo.consume).mockRejectedValueOnce(err);

      await expect(enforceAdminRateLimit('5.6.7.8')).rejects.toThrow(TooManyRequestsError);
    });

    it('propagates non-rate-limit errors', async () => {
      vi.mocked(rateLimitRepo.consume).mockRejectedValueOnce(new Error('DDB down'));

      await expect(enforceAdminRateLimit('1.2.3.4')).rejects.toThrow('DDB down');
    });

    it('floors remaining tokens to integer', async () => {
      vi.mocked(rateLimitRepo.consume).mockResolvedValueOnce({ tokens: 15.3, capacity: 30 });

      const result = await enforceAdminRateLimit('1.2.3.4');
      expect(result.remaining).toBe(15);
    });

    it('includes retryAfter and limit in TooManyRequestsError', async () => {
      vi.mocked(rateLimitRepo.consume).mockResolvedValueOnce(null);

      try {
        await enforceAdminRateLimit('1.2.3.4');
      } catch (err) {
        expect(err).toBeInstanceOf(TooManyRequestsError);
        expect(err.retryAfter).toBeGreaterThan(0);
        expect(err.limit).toBe(30);
      }
    });
  });

  describe('MONTHLY_QUOTAS', () => {
    it('defines quotas for all plan tiers', () => {
      expect(MONTHLY_QUOTAS).toHaveProperty('free');
      expect(MONTHLY_QUOTAS).toHaveProperty('starter');
      expect(MONTHLY_QUOTAS).toHaveProperty('growth');
      expect(MONTHLY_QUOTAS).toHaveProperty('scale');
    });

    it('free tier defaults to 100', () => {
      expect(MONTHLY_QUOTAS.free).toBe(100);
    });

    it('starter tier defaults to 5000', () => {
      expect(MONTHLY_QUOTAS.starter).toBe(5000);
    });

    it('growth tier defaults to 50000', () => {
      expect(MONTHLY_QUOTAS.growth).toBe(50000);
    });

    it('scale tier defaults to 500000', () => {
      expect(MONTHLY_QUOTAS.scale).toBe(500000);
    });

    it('each tier is strictly greater than the previous', () => {
      expect(MONTHLY_QUOTAS.scale).toBeGreaterThan(MONTHLY_QUOTAS.growth);
      expect(MONTHLY_QUOTAS.growth).toBeGreaterThan(MONTHLY_QUOTAS.starter);
      expect(MONTHLY_QUOTAS.starter).toBeGreaterThan(MONTHLY_QUOTAS.free);
    });
  });

  describe('enforceMonthlyQuota', () => {
    beforeEach(() => {
      vi.mocked(usageRepo.getForPeriod).mockReset();
    });

    it('returns quota info when under limit', async () => {
      vi.mocked(usageRepo.getForPeriod).mockResolvedValueOnce({
        accountId: ACC,
        yearMonth: '2026-04',
        callCount: 50,
      });

      const result = await enforceMonthlyQuota(ACC, 'free');
      expect(result).toEqual({ limit: 100, used: 50, remaining: 50 });
    });

    it('throws QuotaExceededError when at limit', async () => {
      vi.mocked(usageRepo.getForPeriod).mockResolvedValueOnce({
        accountId: ACC,
        yearMonth: '2026-04',
        callCount: 100,
      });

      await expect(enforceMonthlyQuota(ACC, 'free')).rejects.toThrow(QuotaExceededError);
    });

    it('throws QuotaExceededError when over limit', async () => {
      vi.mocked(usageRepo.getForPeriod).mockResolvedValueOnce({
        accountId: ACC,
        yearMonth: '2026-04',
        callCount: 150,
      });

      await expect(enforceMonthlyQuota(ACC, 'free')).rejects.toThrow(QuotaExceededError);
    });

    it('uses correct quota for each plan tier', async () => {
      vi.mocked(usageRepo.getForPeriod).mockResolvedValueOnce({
        accountId: ACC,
        yearMonth: '2026-04',
        callCount: 4999,
      });

      const result = await enforceMonthlyQuota(ACC, 'starter');
      expect(result).toEqual({ limit: 5000, used: 4999, remaining: 1 });
    });

    it('defaults unknown plans to free quota', async () => {
      vi.mocked(usageRepo.getForPeriod).mockResolvedValueOnce({
        accountId: ACC,
        yearMonth: '2026-04',
        callCount: 99,
      });

      const result = await enforceMonthlyQuota(ACC, 'enterprise');
      expect(result.limit).toBe(100);
    });

    it('forces anon: accounts to free plan', async () => {
      vi.mocked(usageRepo.getForPeriod).mockResolvedValueOnce({
        accountId: 'anon:1.2.3.4',
        yearMonth: '2026-04',
        callCount: 99,
      });

      const result = await enforceMonthlyQuota('anon:1.2.3.4', 'growth');
      expect(result.limit).toBe(100);
    });

    it('queries current yearMonth', async () => {
      vi.mocked(usageRepo.getForPeriod).mockResolvedValueOnce({
        accountId: ACC,
        yearMonth: '2026-04',
        callCount: 0,
      });

      await enforceMonthlyQuota(ACC, 'free');
      const yearMonth = vi.mocked(usageRepo.getForPeriod).mock.calls[0][1];
      expect(yearMonth).toMatch(/^\d{4}-\d{2}$/);
    });

    it('includes plan and limit details in QuotaExceededError', async () => {
      vi.mocked(usageRepo.getForPeriod).mockResolvedValueOnce({
        accountId: ACC,
        yearMonth: '2026-04',
        callCount: 100,
      });

      try {
        await enforceMonthlyQuota(ACC, 'free');
      } catch (err) {
        expect(err).toBeInstanceOf(QuotaExceededError);
        expect(err.status).toBe(429);
        expect(err.details.plan).toBe('free');
        expect(err.details.monthlyLimit).toBe(100);
        expect(err.details.used).toBe(100);
      }
    });

    it('propagates DDB errors', async () => {
      vi.mocked(usageRepo.getForPeriod).mockRejectedValueOnce(new Error('DDB down'));

      await expect(enforceMonthlyQuota(ACC, 'free')).rejects.toThrow('DDB down');
    });

    it('allows exactly limit - 1 calls', async () => {
      vi.mocked(usageRepo.getForPeriod).mockResolvedValueOnce({
        accountId: ACC,
        yearMonth: '2026-04',
        callCount: 99,
      });

      const result = await enforceMonthlyQuota(ACC, 'free');
      expect(result.remaining).toBe(1);
    });

    it('handles zero usage', async () => {
      vi.mocked(usageRepo.getForPeriod).mockResolvedValueOnce({
        accountId: ACC,
        yearMonth: '2026-04',
        callCount: 0,
      });

      const result = await enforceMonthlyQuota(ACC, 'scale');
      expect(result).toEqual({ limit: 500000, used: 0, remaining: 500000 });
    });
  });

  describe('enforceHealthRateLimit', () => {
    it('calls consume with health#<ip> key and health limits', async () => {
      vi.mocked(rateLimitRepo.consume).mockResolvedValueOnce({ tokens: 59, capacity: 60 });

      const result = await enforceHealthRateLimit('1.2.3.4');
      expect(rateLimitRepo.consume).toHaveBeenCalledWith(
        'health#1.2.3.4',
        60,
        expect.closeTo(60 / 3600, 5),
      );
      expect(result.limit).toBe(60);
      expect(result.remaining).toBe(59);
      expect(result.reset).toBe(Math.ceil(1 / (60 / 3600)));
    });

    it('throws TooManyRequestsError when no tokens', async () => {
      vi.mocked(rateLimitRepo.consume).mockResolvedValueOnce(null);

      await expect(enforceHealthRateLimit('5.6.7.8')).rejects.toThrow(TooManyRequestsError);
    });

    it('treats ConditionalCheckFailedException as rate limited', async () => {
      const err = new Error('condition failed');
      err.name = 'ConditionalCheckFailedException';
      vi.mocked(rateLimitRepo.consume).mockRejectedValueOnce(err);

      await expect(enforceHealthRateLimit('5.6.7.8')).rejects.toThrow(TooManyRequestsError);
    });

    it('propagates non-rate-limit errors', async () => {
      vi.mocked(rateLimitRepo.consume).mockRejectedValueOnce(new Error('DDB down'));

      await expect(enforceHealthRateLimit('1.2.3.4')).rejects.toThrow('DDB down');
    });

    it('floors remaining tokens to integer', async () => {
      vi.mocked(rateLimitRepo.consume).mockResolvedValueOnce({ tokens: 42.7, capacity: 60 });

      const result = await enforceHealthRateLimit('1.2.3.4');
      expect(result.remaining).toBe(42);
    });

    it('includes retryAfter and limit in TooManyRequestsError', async () => {
      vi.mocked(rateLimitRepo.consume).mockResolvedValueOnce(null);

      try {
        await enforceHealthRateLimit('1.2.3.4');
      } catch (err) {
        expect(err).toBeInstanceOf(TooManyRequestsError);
        expect(err.retryAfter).toBeGreaterThan(0);
        expect(err.limit).toBe(60);
      }
    });
  });
});

describe('PLAN_LIMITS env var overrides', () => {
  const envKeys = [
    'RATE_LIMIT_FREE_CAPACITY',
    'RATE_LIMIT_STARTER_CAPACITY',
    'RATE_LIMIT_GROWTH_CAPACITY',
    'RATE_LIMIT_SCALE_CAPACITY',
  ];

  afterEach(() => {
    for (const k of envKeys) delete process.env[k];
    vi.resetModules();
  });

  it('uses default values when env vars are not set', () => {
    expect(PLAN_LIMITS.free.capacity).toBe(10);
    expect(PLAN_LIMITS.starter.capacity).toBe(100);
    expect(PLAN_LIMITS.growth.capacity).toBe(500);
    expect(PLAN_LIMITS.scale.capacity).toBe(2000);
  });

  it('overrides free tier capacity via RATE_LIMIT_FREE_CAPACITY', async () => {
    process.env.RATE_LIMIT_FREE_CAPACITY = '20';
    const mod = await import('../../src/middleware/rate-limit.middleware.js');
    expect(mod.PLAN_LIMITS.free.capacity).toBe(20);
    expect(mod.PLAN_LIMITS.free.refillRate).toBeCloseTo(20 / 60, 5);
  });

  it('overrides starter tier capacity via RATE_LIMIT_STARTER_CAPACITY', async () => {
    process.env.RATE_LIMIT_STARTER_CAPACITY = '200';
    const mod = await import('../../src/middleware/rate-limit.middleware.js');
    expect(mod.PLAN_LIMITS.starter.capacity).toBe(200);
    expect(mod.PLAN_LIMITS.starter.refillRate).toBeCloseTo(200 / 60, 5);
  });

  it('overrides growth tier capacity via RATE_LIMIT_GROWTH_CAPACITY', async () => {
    process.env.RATE_LIMIT_GROWTH_CAPACITY = '1000';
    const mod = await import('../../src/middleware/rate-limit.middleware.js');
    expect(mod.PLAN_LIMITS.growth.capacity).toBe(1000);
    expect(mod.PLAN_LIMITS.growth.refillRate).toBeCloseTo(1000 / 60, 5);
  });

  it('overrides scale tier capacity via RATE_LIMIT_SCALE_CAPACITY', async () => {
    process.env.RATE_LIMIT_SCALE_CAPACITY = '5000';
    const mod = await import('../../src/middleware/rate-limit.middleware.js');
    expect(mod.PLAN_LIMITS.scale.capacity).toBe(5000);
    expect(mod.PLAN_LIMITS.scale.refillRate).toBeCloseTo(5000 / 60, 5);
  });

  it('falls back to defaults for invalid (NaN) env values', async () => {
    process.env.RATE_LIMIT_FREE_CAPACITY = 'notanumber';
    const mod = await import('../../src/middleware/rate-limit.middleware.js');
    expect(mod.PLAN_LIMITS.free.capacity).toBe(10);
  });

  it('computes refillRate as capacity / 60', async () => {
    process.env.RATE_LIMIT_FREE_CAPACITY = '60';
    const mod = await import('../../src/middleware/rate-limit.middleware.js');
    expect(mod.PLAN_LIMITS.free.refillRate).toBe(1);
  });
});

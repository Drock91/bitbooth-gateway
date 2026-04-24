import { TooManyRequestsError, QuotaExceededError } from '../lib/errors.js';
import { rateLimitRepo } from '../repositories/rate-limit.repo.js';
import { usageRepo } from '../repositories/usage.repo.js';

/** Tokens per minute by plan tier (configurable via env vars). */
function buildPlanLimits() {
  const free = Number(process.env.RATE_LIMIT_FREE_CAPACITY) || 10;
  const starter = Number(process.env.RATE_LIMIT_STARTER_CAPACITY) || 100;
  const growth = Number(process.env.RATE_LIMIT_GROWTH_CAPACITY) || 500;
  const scale = Number(process.env.RATE_LIMIT_SCALE_CAPACITY) || 2000;
  return {
    free: { capacity: free, refillRate: free / 60 },
    starter: { capacity: starter, refillRate: starter / 60 },
    growth: { capacity: growth, refillRate: growth / 60 },
    scale: { capacity: scale, refillRate: scale / 60 },
  };
}

const PLAN_LIMITS = buildPlanLimits();

const SIGNUP_CAPACITY = Number(process.env.SIGNUP_RATE_LIMIT_CAPACITY) || 5;
const SIGNUP_REFILL_RATE = Number(process.env.SIGNUP_RATE_LIMIT_REFILL_RATE) || 5 / 3600;

const ADMIN_CAPACITY = Number(process.env.ADMIN_RATE_LIMIT_CAPACITY) || 30;
const ADMIN_REFILL_RATE = Number(process.env.ADMIN_RATE_LIMIT_REFILL_RATE) || 30 / 3600;

const HEALTH_CAPACITY = Number(process.env.HEALTH_RATE_LIMIT_CAPACITY) || 60;
const HEALTH_REFILL_RATE = Number(process.env.HEALTH_RATE_LIMIT_REFILL_RATE) || 60 / 3600;

/**
 * Build standard RateLimit-* response headers.
 * @param {{ limit: number, remaining: number, reset: number }} info
 */
export function rateLimitHeaders(info) {
  return {
    'ratelimit-limit': String(info.limit),
    'ratelimit-remaining': String(info.remaining),
    'ratelimit-reset': String(info.reset),
  };
}

/**
 * Enforce per-tenant rate limit based on their subscription plan.
 * Consumes one token from the DDB token bucket. Throws 429 when exhausted.
 * Returns rate limit info for response headers on success.
 *
 * @param {string} accountId
 * @param {string} plan – one of free|starter|growth|scale
 * @returns {Promise<{limit: number, remaining: number, reset: number}>}
 */
export async function enforceRateLimit(accountId, plan) {
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
  const reset = Math.ceil(1 / limits.refillRate);

  try {
    const result = await rateLimitRepo.consume(accountId, limits.capacity, limits.refillRate);
    if (!result) {
      throw new TooManyRequestsError(reset, limits.capacity);
    }
    return {
      limit: limits.capacity,
      remaining: Math.floor(result.tokens),
      reset,
    };
  } catch (err) {
    if (err instanceof TooManyRequestsError) throw err;
    if (err?.name === 'ConditionalCheckFailedException') {
      throw new TooManyRequestsError(reset, limits.capacity);
    }
    throw err;
  }
}

/**
 * Extract client IP from API Gateway event.
 * @param {object} event – Lambda proxy event
 * @returns {string}
 */
export function extractClientIp(event) {
  return (
    event?.requestContext?.identity?.sourceIp ??
    event?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ??
    'unknown'
  );
}

/**
 * Enforce IP-based rate limit on signup endpoint.
 * Uses the same DDB table with a `signup#<ip>` key.
 * Default: 5 signups per hour per IP.
 *
 * @param {string} clientIp
 * @returns {Promise<{limit: number, remaining: number, reset: number}>}
 */
export async function enforceSignupRateLimit(clientIp) {
  const key = `signup#${clientIp}`;
  const reset = Math.ceil(1 / SIGNUP_REFILL_RATE);

  try {
    const result = await rateLimitRepo.consume(key, SIGNUP_CAPACITY, SIGNUP_REFILL_RATE);
    if (!result) {
      throw new TooManyRequestsError(reset, SIGNUP_CAPACITY);
    }
    return {
      limit: SIGNUP_CAPACITY,
      remaining: Math.floor(result.tokens),
      reset,
    };
  } catch (err) {
    if (err instanceof TooManyRequestsError) throw err;
    if (err?.name === 'ConditionalCheckFailedException') {
      throw new TooManyRequestsError(reset, SIGNUP_CAPACITY);
    }
    throw err;
  }
}

/**
 * Enforce IP-based rate limit on admin endpoints.
 * Uses the same DDB table with an `admin#<ip>` key.
 * Default: 30 requests per hour per IP.
 *
 * @param {string} clientIp
 * @returns {Promise<{limit: number, remaining: number, reset: number}>}
 */
export async function enforceAdminRateLimit(clientIp) {
  const key = `admin#${clientIp}`;
  const reset = Math.ceil(1 / ADMIN_REFILL_RATE);

  try {
    const result = await rateLimitRepo.consume(key, ADMIN_CAPACITY, ADMIN_REFILL_RATE);
    if (!result) {
      throw new TooManyRequestsError(reset, ADMIN_CAPACITY);
    }
    return {
      limit: ADMIN_CAPACITY,
      remaining: Math.floor(result.tokens),
      reset,
    };
  } catch (err) {
    if (err instanceof TooManyRequestsError) throw err;
    if (err?.name === 'ConditionalCheckFailedException') {
      throw new TooManyRequestsError(reset, ADMIN_CAPACITY);
    }
    throw err;
  }
}

/**
 * Enforce IP-based rate limit on health check endpoints.
 * Uses the same DDB table with a `health#<ip>` key.
 * Default: 60 requests per hour per IP.
 *
 * @param {string} clientIp
 * @returns {Promise<{limit: number, remaining: number, reset: number}>}
 */
export async function enforceHealthRateLimit(clientIp) {
  const key = `health#${clientIp}`;
  const reset = Math.ceil(1 / HEALTH_REFILL_RATE);

  try {
    const result = await rateLimitRepo.consume(key, HEALTH_CAPACITY, HEALTH_REFILL_RATE);
    if (!result) {
      throw new TooManyRequestsError(reset, HEALTH_CAPACITY);
    }
    return {
      limit: HEALTH_CAPACITY,
      remaining: Math.floor(result.tokens),
      reset,
    };
  } catch (err) {
    if (err instanceof TooManyRequestsError) throw err;
    if (err?.name === 'ConditionalCheckFailedException') {
      throw new TooManyRequestsError(reset, HEALTH_CAPACITY);
    }
    throw err;
  }
}

/** Monthly fetch quotas per plan (configurable via env vars). */
function buildMonthlyQuotas() {
  return {
    free: Number(process.env.MONTHLY_QUOTA_FREE) || 100,
    starter: Number(process.env.MONTHLY_QUOTA_STARTER) || 5000,
    growth: Number(process.env.MONTHLY_QUOTA_GROWTH) || 50000,
    scale: Number(process.env.MONTHLY_QUOTA_SCALE) || 500000,
  };
}

const MONTHLY_QUOTAS = buildMonthlyQuotas();

/**
 * Enforce monthly fetch quota for a tenant based on their plan.
 * Reads the current month's usage from DDB and rejects if the quota is exhausted.
 *
 * @param {string} accountId
 * @param {string} plan
 * @returns {Promise<{limit: number, used: number, remaining: number}>}
 */
export async function enforceMonthlyQuota(accountId, plan) {
  if (accountId.startsWith('anon:')) plan = 'free';
  const limit = MONTHLY_QUOTAS[plan] ?? MONTHLY_QUOTAS.free;
  const yearMonth = new Date().toISOString().slice(0, 7);
  const usage = await usageRepo.getForPeriod(accountId, yearMonth);
  const used = usage.callCount;

  if (used >= limit) {
    throw new QuotaExceededError(plan, limit, used);
  }

  return { limit, used, remaining: limit - used };
}

export { PLAN_LIMITS, MONTHLY_QUOTAS };

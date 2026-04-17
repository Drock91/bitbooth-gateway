import { UpstreamError } from '../lib/errors.js';

const DEFAULTS = {
  maxAttempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 5000,
};

/**
 * Returns true for errors that are safe to retry (transient network/upstream).
 * Non-retryable: validation, auth, not-found, fraud, conflict, config errors.
 */
export function isRetryable(err) {
  if (err instanceof UpstreamError) {
    const reason = err.details?.reason;
    if (reason === 'not-configured' || reason === 'no-rpc-url') return false;
    return true;
  }
  if (err?.name === 'AbortError') return true;
  if (
    err?.code === 'ECONNRESET' ||
    err?.code === 'ECONNREFUSED' ||
    err?.code === 'ETIMEDOUT' ||
    err?.code === 'UND_ERR_CONNECT_TIMEOUT' ||
    err?.code === 'EPIPE'
  )
    return true;
  if (err?.code === 'SERVER_ERROR') return true;
  return false;
}

/**
 * Full-jitter exponential backoff: uniform random in [0, min(maxDelay, base * 2^attempt)].
 */
export function computeDelay(attempt, baseDelayMs, maxDelayMs) {
  const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return Math.floor(Math.random() * cap);
}

/**
 * Retry wrapper with exponential backoff and jitter.
 *
 * @param {() => Promise<T>} fn - async function to retry
 * @param {object} [opts]
 * @param {number} [opts.maxAttempts=3]
 * @param {number} [opts.baseDelayMs=200]
 * @param {number} [opts.maxDelayMs=5000]
 * @param {(err: Error) => boolean} [opts.isRetryable] - override retryable check
 * @returns {Promise<T>}
 */
export async function withRetry(fn, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? DEFAULTS.maxAttempts;
  const baseDelayMs = opts.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const maxDelayMs = opts.maxDelayMs ?? DEFAULTS.maxDelayMs;
  const check = opts.isRetryable ?? isRetryable;

  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt + 1 >= maxAttempts || !check(err)) throw err;
      const delay = computeDelay(attempt, baseDelayMs, maxDelayMs);
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

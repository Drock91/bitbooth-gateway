import { UpstreamError } from './errors.js';
import { withRetry } from '../adapters/retry.js';

const DEFAULT_TIMEOUT_MS = 10_000;

export function getAdapterTimeoutMs() {
  const env = process.env.ADAPTER_HTTP_TIMEOUT_MS;
  if (env) {
    const n = Number(env);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_TIMEOUT_MS;
}

export async function fetchWithTimeout(url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? getAdapterTimeoutMs();
  const retryOpts = opts.retry ?? {};
  const { timeoutMs: _, retry: __, ...fetchOpts } = opts;

  return withRetry(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...fetchOpts, signal: controller.signal });
      return res;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new UpstreamError('http', { reason: 'timeout', url, timeoutMs });
      }
      throw err;
      /* v8 ignore next -- catch always throws; V8 instruments unreachable fallthrough */
    } finally {
      clearTimeout(timer);
    }
  }, retryOpts);
}

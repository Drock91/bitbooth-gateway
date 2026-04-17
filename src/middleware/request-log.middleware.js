import { withCorrelation } from '../lib/logger.js';
import { randomUUID } from 'node:crypto';

/**
 * Wraps a Lambda handler with structured request logging.
 * Logs method, path, status, latency, and correlationId on every response.
 * @param {(event: object, ctx: {correlationId: string, log: object}) => Promise<object>} fn
 * @returns {(event: object) => Promise<object>}
 */
export function withRequestLogging(fn) {
  return async (event) => {
    const correlationId = event.headers?.['x-correlation-id'] ?? randomUUID();
    const log = withCorrelation(correlationId);
    const method = event.httpMethod ?? 'UNKNOWN';
    const path = event.path ?? '/';
    const start = Date.now();

    let res;
    try {
      res = await fn(event, { correlationId, log });
    } catch (err) {
      const ms = Date.now() - start;
      log.error({ method, path, ms, err }, 'request error');
      throw err;
    }

    const ms = Date.now() - start;
    const status = res?.statusCode ?? 0;
    log.info({ method, path, status, ms }, 'request');

    res.headers = { ...res.headers, 'x-correlation-id': correlationId };
    return res;
  };
}

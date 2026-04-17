import { flushLogger } from '../lib/logger.js';

/**
 * Wraps a Lambda handler to ensure pino logs (including EMF metrics)
 * are flushed before the response is returned to the runtime.
 * @param {Function} fn - handler function (event, context) => Promise<object>
 * @returns {Function}
 */
export function withGracefulShutdown(fn) {
  return async (event, context) => {
    let handlerErr;
    let res;
    try {
      res = await fn(event, context);
    } catch (err) {
      handlerErr = err;
    }
    try {
      await flushLogger();
    } catch (flushErr) {
      if (handlerErr) throw handlerErr;
      throw flushErr;
    }
    if (handlerErr) throw handlerErr;
    return res;
  };
}

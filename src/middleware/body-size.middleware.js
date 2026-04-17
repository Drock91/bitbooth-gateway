import { jsonResponse } from './error.middleware.js';

const DEFAULT_MAX_BYTES = 102400; // 100 KB

/**
 * Wraps a Lambda handler to reject requests whose body exceeds a byte limit.
 * Returns 413 Payload Too Large directly — does not throw, since the error
 * middleware catch lives inside the inner handler.
 * @param {(event: object, ctx?: object) => Promise<object>} fn
 * @param {{ maxBytes?: number }} [opts]
 * @returns {(event: object, ctx?: object) => Promise<object>}
 */
export function withBodySizeLimit(fn, opts = {}) {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  return async (event, ctx) => {
    const body = event.body;
    if (body && Buffer.byteLength(body, 'utf8') > maxBytes) {
      return jsonResponse(413, {
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: `Request body exceeds ${maxBytes} bytes`,
          maxBytes,
        },
      });
    }
    return fn(event, ctx);
  };
}

export { DEFAULT_MAX_BYTES };

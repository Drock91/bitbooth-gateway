import { isAppError, TooManyRequestsError } from '../lib/errors.js';
import { withCorrelation } from '../lib/logger.js';

export function jsonResponse(status, body) {
  return {
    statusCode: status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

export function toHttpResponse(err, correlationId) {
  const log = withCorrelation(correlationId);

  if (err instanceof TooManyRequestsError) {
    log.warn({ code: err.code, retryAfter: err.retryAfter }, 'rate limited');
    return {
      statusCode: 429,
      headers: {
        'content-type': 'application/json',
        'retry-after': String(err.retryAfter),
        'ratelimit-limit': String(err.limit),
        'ratelimit-remaining': '0',
        'ratelimit-reset': String(err.retryAfter),
        'cache-control': 'no-store',
      },
      body: JSON.stringify({
        error: { code: err.code, message: err.message, retryAfter: err.retryAfter },
        correlationId,
      }),
    };
  }

  if (isAppError(err)) {
    log.warn({ code: err.code, status: err.status }, 'handled error');
    return jsonResponse(err.status, {
      error: { code: err.code, message: err.message, details: err.details },
      correlationId,
    });
  }

  log.error({ err }, 'unhandled error');
  return jsonResponse(500, {
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    correlationId,
  });
}

export function paymentRequiredResponse(err, correlationId) {
  return {
    statusCode: 402,
    headers: {
      'content-type': 'application/json',
      'www-authenticate': 'X402',
    },
    body: JSON.stringify({
      error: { code: err.code, message: err.message },
      challenge: err.details,
      correlationId,
    }),
  };
}

import { idempotencyRepo } from '../repositories/idempotency.repo.js';
import { ConflictError, ValidationError, isAppError } from '../lib/errors.js';
import { IdempotencyKey } from '../validators/idempotency.schema.js';

/**
 * Idempotency middleware for POST/PUT/PATCH requests.
 * Reads `Idempotency-Key` header. If a completed response exists, returns it.
 * If in-progress, throws 409. Otherwise locks the key and lets the request proceed.
 *
 * @param {Record<string, string>} headers - lowercased request headers
 * @param {() => Promise<{statusCode: number, headers: Record<string, string>, body: string}>} handler - the downstream handler
 * @returns {Promise<{statusCode: number, headers: Record<string, string>, body: string}>}
 */
export async function withIdempotency(headers, handler) {
  const raw = headers['idempotency-key'];
  if (!raw) return handler();

  const parsed = IdempotencyKey.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues);
  }
  const key = parsed.data;

  const existing = await idempotencyRepo.get(key);

  if (existing) {
    if (existing.status === 'completed') {
      return {
        statusCode: existing.statusCode,
        headers: { ...existing.responseHeaders, 'x-idempotent-replay': 'true' },
        body: existing.responseBody,
      };
    }
    throw new ConflictError('request already in progress for this idempotency key');
  }

  await idempotencyRepo.lockKey(key);

  try {
    const response = await handler();
    await idempotencyRepo.complete(key, response.statusCode, response.body, response.headers ?? {});
    return response;
  } catch (err) {
    if (isAppError(err) && err.status < 500) {
      // Client errors are permanent — cache so retries get the same response
      const body = JSON.stringify({ error: err.code, message: err.message, details: err.details });
      await idempotencyRepo.complete(key, err.status, body, {});
    } else {
      // Server errors are transient — release the lock so clients can retry
      await idempotencyRepo.release(key);
    }
    throw err;
  }
}

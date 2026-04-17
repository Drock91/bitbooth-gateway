import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGet, mockLockKey, mockComplete, mockRelease } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockLockKey: vi.fn(),
  mockComplete: vi.fn(),
  mockRelease: vi.fn(),
}));

vi.mock('../../src/repositories/idempotency.repo.js', () => ({
  idempotencyRepo: {
    get: mockGet,
    lockKey: mockLockKey,
    complete: mockComplete,
    release: mockRelease,
  },
}));

vi.mock('../../src/lib/config.js', () => ({
  getConfig: () => ({ awsRegion: 'us-east-1' }),
}));

import { withIdempotency } from '../../src/middleware/idempotency.middleware.js';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const okResponse = {
  statusCode: 200,
  headers: { 'content-type': 'application/json' },
  body: '{"ok":true}',
};

describe('withIdempotency', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockLockKey.mockReset();
    mockComplete.mockReset();
    mockRelease.mockReset();
  });

  it('passes through when no Idempotency-Key header', async () => {
    const handler = vi.fn().mockResolvedValue(okResponse);
    const result = await withIdempotency({}, handler);
    expect(result).toEqual(okResponse);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('throws ValidationError for non-UUID key', async () => {
    const handler = vi.fn();
    await expect(withIdempotency({ 'idempotency-key': 'not-a-uuid' }, handler)).rejects.toThrow(
      'Invalid request',
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('ValidationError has status 400', async () => {
    try {
      await withIdempotency({ 'idempotency-key': 'bad' }, vi.fn());
    } catch (e) {
      expect(e.status).toBe(400);
      expect(e.code).toBe('VALIDATION_ERROR');
      return;
    }
    throw new Error('expected error');
  });

  it('returns cached response for completed key', async () => {
    mockGet.mockResolvedValueOnce({
      idempotencyKey: VALID_UUID,
      status: 'completed',
      statusCode: 200,
      responseBody: '{"cached":true}',
      responseHeaders: { 'content-type': 'application/json' },
    });
    const handler = vi.fn();
    const result = await withIdempotency({ 'idempotency-key': VALID_UUID }, handler);
    expect(result.statusCode).toBe(200);
    expect(result.body).toBe('{"cached":true}');
    expect(result.headers['x-idempotent-replay']).toBe('true');
    expect(handler).not.toHaveBeenCalled();
  });

  it('throws ConflictError for in_progress key', async () => {
    mockGet.mockResolvedValueOnce({
      idempotencyKey: VALID_UUID,
      status: 'in_progress',
    });
    await expect(withIdempotency({ 'idempotency-key': VALID_UUID }, vi.fn())).rejects.toThrow(
      'request already in progress',
    );
  });

  it('ConflictError has status 409', async () => {
    mockGet.mockResolvedValueOnce({ status: 'in_progress' });
    try {
      await withIdempotency({ 'idempotency-key': VALID_UUID }, vi.fn());
    } catch (e) {
      expect(e.status).toBe(409);
      expect(e.code).toBe('CONFLICT');
      return;
    }
    throw new Error('expected error');
  });

  it('locks key and executes handler for new key', async () => {
    mockGet.mockResolvedValueOnce(null);
    mockLockKey.mockResolvedValueOnce(undefined);
    mockComplete.mockResolvedValueOnce(undefined);
    const handler = vi.fn().mockResolvedValue(okResponse);

    const result = await withIdempotency({ 'idempotency-key': VALID_UUID }, handler);
    expect(mockLockKey).toHaveBeenCalledWith(VALID_UUID);
    expect(handler).toHaveBeenCalledOnce();
    expect(mockComplete).toHaveBeenCalledWith(VALID_UUID, 200, '{"ok":true}', {
      'content-type': 'application/json',
    });
    expect(result).toEqual(okResponse);
  });

  it('releases lock and re-throws on generic (5xx) handler error', async () => {
    mockGet.mockResolvedValueOnce(null);
    mockLockKey.mockResolvedValueOnce(undefined);
    mockRelease.mockResolvedValueOnce(undefined);
    const handler = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(withIdempotency({ 'idempotency-key': VALID_UUID }, handler)).rejects.toThrow(
      'boom',
    );
    expect(mockRelease).toHaveBeenCalledWith(VALID_UUID);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('caches 4xx AppError with correct status and re-throws', async () => {
    const { ValidationError } = await import('../../src/lib/errors.js');
    mockGet.mockResolvedValueOnce(null);
    mockLockKey.mockResolvedValueOnce(undefined);
    mockComplete.mockResolvedValueOnce(undefined);
    const handler = vi.fn().mockRejectedValue(new ValidationError([{ message: 'bad field' }]));

    await expect(withIdempotency({ 'idempotency-key': VALID_UUID }, handler)).rejects.toThrow(
      'Invalid request',
    );
    expect(mockComplete).toHaveBeenCalledWith(
      VALID_UUID,
      400,
      expect.stringContaining('VALIDATION_ERROR'),
      {},
    );
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('caches 404 NotFoundError with correct status', async () => {
    const { NotFoundError } = await import('../../src/lib/errors.js');
    mockGet.mockResolvedValueOnce(null);
    mockLockKey.mockResolvedValueOnce(undefined);
    mockComplete.mockResolvedValueOnce(undefined);
    const handler = vi.fn().mockRejectedValue(new NotFoundError('Route'));

    await expect(withIdempotency({ 'idempotency-key': VALID_UUID }, handler)).rejects.toThrow(
      'Route not found',
    );
    expect(mockComplete).toHaveBeenCalledWith(VALID_UUID, 404, expect.any(String), {});
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('releases lock on 5xx UpstreamError to allow retry', async () => {
    const { UpstreamError } = await import('../../src/lib/errors.js');
    mockGet.mockResolvedValueOnce(null);
    mockLockKey.mockResolvedValueOnce(undefined);
    mockRelease.mockResolvedValueOnce(undefined);
    const handler = vi.fn().mockRejectedValue(new UpstreamError('exchange', { reason: 'timeout' }));

    await expect(withIdempotency({ 'idempotency-key': VALID_UUID }, handler)).rejects.toThrow(
      'Upstream exchange failed',
    );
    expect(mockRelease).toHaveBeenCalledWith(VALID_UUID);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('passes response headers as empty object when missing', async () => {
    mockGet.mockResolvedValueOnce(null);
    mockLockKey.mockResolvedValueOnce(undefined);
    mockComplete.mockResolvedValueOnce(undefined);
    const noHeadersResponse = { statusCode: 200, body: '{}' };
    const handler = vi.fn().mockResolvedValue(noHeadersResponse);

    await withIdempotency({ 'idempotency-key': VALID_UUID }, handler);
    expect(mockComplete).toHaveBeenCalledWith(VALID_UUID, 200, '{}', {});
  });

  it('preserves original response headers in cached response', async () => {
    mockGet.mockResolvedValueOnce({
      status: 'completed',
      statusCode: 201,
      responseBody: '{"id":"new"}',
      responseHeaders: { 'x-custom': 'value', 'content-type': 'application/json' },
    });
    const result = await withIdempotency({ 'idempotency-key': VALID_UUID }, vi.fn());
    expect(result.headers['x-custom']).toBe('value');
    expect(result.headers['content-type']).toBe('application/json');
    expect(result.headers['x-idempotent-replay']).toBe('true');
    expect(result.statusCode).toBe(201);
  });

  it('does not call lockKey when key already exists', async () => {
    mockGet.mockResolvedValueOnce({
      status: 'completed',
      statusCode: 200,
      responseBody: '{}',
      responseHeaders: {},
    });
    await withIdempotency({ 'idempotency-key': VALID_UUID }, vi.fn());
    expect(mockLockKey).not.toHaveBeenCalled();
  });

  it('propagates lockKey ConflictError (race condition)', async () => {
    mockGet.mockResolvedValueOnce(null);
    const err = new Error('conflict');
    err.name = 'ConflictError';
    err.status = 409;
    err.code = 'CONFLICT';
    mockLockKey.mockRejectedValueOnce(err);
    await expect(withIdempotency({ 'idempotency-key': VALID_UUID }, vi.fn())).rejects.toThrow(
      'conflict',
    );
  });
});

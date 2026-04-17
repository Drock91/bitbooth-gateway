import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DynamoDBDocumentClient, ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { isLocalStackUp, createTable, destroyTable, ddbClient } from './helpers.js';
import { randomUUID } from 'node:crypto';

let available = false;
let withIdempotency;
let idempotencyRepo;
const docClient = DynamoDBDocumentClient.from(ddbClient);

async function clearTable() {
  const res = await ddbClient.send(new ScanCommand({ TableName: 'x402-idempotency' }));
  if (!res.Items?.length) return;
  for (const item of res.Items) {
    const key = item.idempotencyKey?.S ?? item.idempotencyKey;
    await docClient.send(
      new DeleteCommand({ TableName: 'x402-idempotency', Key: { idempotencyKey: key } }),
    );
  }
}

beforeAll(async () => {
  available = await isLocalStackUp();
  if (!available) return;
  await createTable('idempotency');
  const mw = await import('../../src/middleware/idempotency.middleware.js');
  withIdempotency = mw.withIdempotency;
  const repo = await import('../../src/repositories/idempotency.repo.js');
  idempotencyRepo = repo.idempotencyRepo;
});

afterAll(async () => {
  if (available) await destroyTable('idempotency');
});

describe('idempotency middleware integration', () => {
  beforeEach(async () => {
    if (!available) return;
    await clearTable();
  });

  // --- No header: pass-through ---

  it.skipIf(!available)('passes through when no Idempotency-Key header', async () => {
    const handler = async () => ({ statusCode: 200, headers: {}, body: '{"ok":true}' });
    const result = await withIdempotency({}, handler);
    expect(result.statusCode).toBe(200);
    expect(result.body).toBe('{"ok":true}');
    expect(result.headers['x-idempotent-replay']).toBeUndefined();
  });

  // --- First request with key: processes and caches ---

  it.skipIf(!available)('processes first request and caches response', async () => {
    const key = randomUUID();
    let callCount = 0;
    const handler = async () => {
      callCount++;
      return { statusCode: 201, headers: { 'x-custom': 'val' }, body: '{"created":true}' };
    };

    const result = await withIdempotency({ 'idempotency-key': key }, handler);
    expect(result.statusCode).toBe(201);
    expect(result.body).toBe('{"created":true}');
    expect(callCount).toBe(1);

    const record = await idempotencyRepo.get(key);
    expect(record).toBeTruthy();
    expect(record.status).toBe('completed');
    expect(record.statusCode).toBe(201);
    expect(record.responseBody).toBe('{"created":true}');
    expect(record.responseHeaders).toEqual({ 'x-custom': 'val' });
  });

  // --- Duplicate key: returns cached response without re-executing ---

  it.skipIf(!available)('returns cached response for duplicate key', async () => {
    const key = randomUUID();
    let callCount = 0;
    const handler = async () => {
      callCount++;
      return { statusCode: 200, headers: { 'x-foo': 'bar' }, body: '{"data":1}' };
    };

    await withIdempotency({ 'idempotency-key': key }, handler);
    expect(callCount).toBe(1);

    const replay = await withIdempotency({ 'idempotency-key': key }, handler);
    expect(callCount).toBe(1);
    expect(replay.statusCode).toBe(200);
    expect(replay.body).toBe('{"data":1}');
    expect(replay.headers['x-idempotent-replay']).toBe('true');
    expect(replay.headers['x-foo']).toBe('bar');
  });

  // --- Unique keys process independently ---

  it.skipIf(!available)('processes requests with unique keys independently', async () => {
    const results = [];
    for (let i = 0; i < 3; i++) {
      const key = randomUUID();
      const handler = async () => ({
        statusCode: 200,
        headers: {},
        body: JSON.stringify({ idx: i }),
      });
      const result = await withIdempotency({ 'idempotency-key': key }, handler);
      results.push(result);
    }

    expect(results).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(JSON.parse(results[i].body).idx).toBe(i);
    }
  });

  // --- Invalid UUID key: 400 validation error ---

  it.skipIf(!available)('rejects non-UUID idempotency key with ValidationError', async () => {
    const handler = async () => ({ statusCode: 200, headers: {}, body: '{}' });
    try {
      await withIdempotency({ 'idempotency-key': 'not-a-uuid' }, handler);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e.constructor.name).toBe('ValidationError');
    }
  });

  // --- In-progress conflict: 409 ---

  it.skipIf(!available)('throws ConflictError when key is in-progress', async () => {
    const key = randomUUID();
    await idempotencyRepo.lockKey(key);

    const handler = async () => ({ statusCode: 200, headers: {}, body: '{}' });
    try {
      await withIdempotency({ 'idempotency-key': key }, handler);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e.constructor.name).toBe('ConflictError');
    }
  });

  // --- 4xx client error: cached so retries get same response ---

  it.skipIf(!available)('caches 4xx client error and replays it', async () => {
    const key = randomUUID();
    const { ValidationError } = await import('../../src/lib/errors.js');

    let callCount = 0;
    const handler = async () => {
      callCount++;
      throw new ValidationError('bad input');
    };

    try {
      await withIdempotency({ 'idempotency-key': key }, handler);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e.constructor.name).toBe('ValidationError');
    }
    expect(callCount).toBe(1);

    const record = await idempotencyRepo.get(key);
    expect(record.status).toBe('completed');
    expect(record.statusCode).toBe(400);

    const replay = await withIdempotency({ 'idempotency-key': key }, handler);
    expect(callCount).toBe(1);
    expect(replay.statusCode).toBe(400);
    expect(replay.headers['x-idempotent-replay']).toBe('true');
  });

  // --- 5xx server error: lock released, retry allowed ---

  it.skipIf(!available)('releases lock on 5xx so retry can proceed', async () => {
    const key = randomUUID();

    let attempt = 0;
    const handler = async () => {
      attempt++;
      if (attempt === 1) throw new Error('transient failure');
      return { statusCode: 200, headers: {}, body: '{"recovered":true}' };
    };

    try {
      await withIdempotency({ 'idempotency-key': key }, handler);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e.message).toBe('transient failure');
    }

    const afterFail = await idempotencyRepo.get(key);
    expect(afterFail).toBeNull();

    const result = await withIdempotency({ 'idempotency-key': key }, handler);
    expect(result.statusCode).toBe(200);
    expect(result.body).toBe('{"recovered":true}');
    expect(attempt).toBe(2);
  });

  // --- TTL is set on records ---

  it.skipIf(!available)('sets TTL on idempotency records', async () => {
    const key = randomUUID();
    const handler = async () => ({ statusCode: 200, headers: {}, body: '{}' });
    await withIdempotency({ 'idempotency-key': key }, handler);

    const record = await idempotencyRepo.get(key);
    expect(record.ttl).toBeTypeOf('number');
    const nowEpoch = Math.floor(Date.now() / 1000);
    expect(record.ttl).toBeGreaterThan(nowEpoch);
    expect(record.ttl).toBeLessThanOrEqual(nowEpoch + 86400 + 5);
  });

  // --- Response headers preserved through cache ---

  it.skipIf(!available)('preserves response headers in cached replay', async () => {
    const key = randomUUID();
    const handler = async () => ({
      statusCode: 200,
      headers: { 'content-type': 'application/json', 'x-request-id': 'abc-123' },
      body: '{"ok":true}',
    });

    await withIdempotency({ 'idempotency-key': key }, handler);
    const replay = await withIdempotency({ 'idempotency-key': key }, handler);

    expect(replay.headers['content-type']).toBe('application/json');
    expect(replay.headers['x-request-id']).toBe('abc-123');
    expect(replay.headers['x-idempotent-replay']).toBe('true');
  });

  // --- Concurrent duplicate: second caller gets ConflictError ---

  it.skipIf(!available)('second concurrent request gets ConflictError', async () => {
    const key = randomUUID();

    let resolveFirst;
    const firstBlocked = new Promise((r) => {
      resolveFirst = r;
    });

    const slowHandler = async () => {
      await firstBlocked;
      return { statusCode: 200, headers: {}, body: '{"slow":true}' };
    };

    const firstPromise = withIdempotency({ 'idempotency-key': key }, slowHandler);

    await new Promise((r) => setTimeout(r, 50));

    try {
      await withIdempotency({ 'idempotency-key': key }, slowHandler);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e.constructor.name).toBe('ConflictError');
    }

    resolveFirst();
    const result = await firstPromise;
    expect(result.statusCode).toBe(200);
  });

  // --- Handler with no headers field in response ---

  it.skipIf(!available)('handles response with no headers field', async () => {
    const key = randomUUID();
    const handler = async () => ({ statusCode: 204, body: '' });

    const result = await withIdempotency({ 'idempotency-key': key }, handler);
    expect(result.statusCode).toBe(204);

    const replay = await withIdempotency({ 'idempotency-key': key }, handler);
    expect(replay.statusCode).toBe(204);
    expect(replay.headers['x-idempotent-replay']).toBe('true');
  });

  // --- Multiple different completed keys can all replay ---

  it.skipIf(!available)('replays multiple different cached responses correctly', async () => {
    const keys = [randomUUID(), randomUUID(), randomUUID()];

    for (let i = 0; i < keys.length; i++) {
      const handler = async () => ({
        statusCode: 200 + i,
        headers: {},
        body: JSON.stringify({ key: i }),
      });
      await withIdempotency({ 'idempotency-key': keys[i] }, handler);
    }

    for (let i = 0; i < keys.length; i++) {
      const neverCalled = async () => {
        throw new Error('should not be called');
      };
      const replay = await withIdempotency({ 'idempotency-key': keys[i] }, neverCalled);
      expect(replay.statusCode).toBe(200 + i);
      expect(JSON.parse(replay.body).key).toBe(i);
      expect(replay.headers['x-idempotent-replay']).toBe('true');
    }
  });
});

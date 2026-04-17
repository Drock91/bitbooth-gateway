import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { DynamoDBDocumentClient, ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { isLocalStackUp, createTable, destroyTable, ddbClient } from './helpers.js';

vi.mock('../../src/lib/metrics.js', () => ({
  emitMetric: vi.fn(),
  paymentVerified: vi.fn(),
  paymentFailed: vi.fn(),
}));

let available = false;
let enforceRateLimit, enforceSignupRateLimit, enforceAdminRateLimit, enforceHealthRateLimit;
let rateLimitRepo;
const docClient = DynamoDBDocumentClient.from(ddbClient);

const TABLE_NAME = 'x402-rate-limits';

async function clearTable() {
  const res = await ddbClient.send(new ScanCommand({ TableName: TABLE_NAME }));
  if (!res.Items?.length) return;
  for (const item of res.Items) {
    const accountId = item.accountId?.S;
    if (accountId) {
      await docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { accountId } }));
    }
  }
}

beforeAll(async () => {
  available = await isLocalStackUp();
  if (!available) return;

  await createTable('rate-limits');

  const middleware = await import('../../src/middleware/rate-limit.middleware.js');
  enforceRateLimit = middleware.enforceRateLimit;
  enforceSignupRateLimit = middleware.enforceSignupRateLimit;
  enforceAdminRateLimit = middleware.enforceAdminRateLimit;
  enforceHealthRateLimit = middleware.enforceHealthRateLimit;

  const repo = await import('../../src/repositories/rate-limit.repo.js');
  rateLimitRepo = repo.rateLimitRepo;
});

afterAll(async () => {
  if (!available) return;
  await destroyTable('rate-limits');
});

describe('rate-limit integration', () => {
  beforeEach(async () => {
    if (!available) return;
    await clearTable();
  });

  // --- First request creates bucket ---

  it.skipIf(!available)('first request creates bucket with capacity-1 tokens', async () => {
    const info = await enforceRateLimit('tenant-001', 'free');
    expect(info.limit).toBe(10);
    expect(info.remaining).toBe(9);
    expect(info.reset).toBeTypeOf('number');

    const bucket = await rateLimitRepo.getBucket('tenant-001');
    expect(bucket).not.toBeNull();
    expect(bucket.tokens).toBe(9);
    expect(bucket.capacity).toBe(10);
  });

  // --- Exhaust free-tier bucket → 429 ---

  it.skipIf(!available)(
    'throws TooManyRequestsError after exhausting free-tier tokens',
    async () => {
      const accountId = 'tenant-exhaust';
      for (let i = 0; i < 10; i++) {
        const info = await enforceRateLimit(accountId, 'free');
        expect(info.remaining).toBe(9 - i);
      }

      try {
        await enforceRateLimit(accountId, 'free');
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e.constructor.name).toBe('TooManyRequestsError');
        expect(e.statusCode).toBe(429);
      }
    },
  );

  // --- Different tenants have isolated buckets ---

  it.skipIf(!available)('isolates rate-limit buckets per tenant', async () => {
    await enforceRateLimit('tenant-A', 'free');
    await enforceRateLimit('tenant-B', 'free');

    const bucketA = await rateLimitRepo.getBucket('tenant-A');
    const bucketB = await rateLimitRepo.getBucket('tenant-B');
    expect(bucketA.tokens).toBe(9);
    expect(bucketB.tokens).toBe(9);
  });

  // --- Plan tiers give different capacities ---

  it.skipIf(!available)('starter plan gets 100-token capacity', async () => {
    const info = await enforceRateLimit('tenant-starter', 'starter');
    expect(info.limit).toBe(100);
    expect(info.remaining).toBe(99);
  });

  it.skipIf(!available)('growth plan gets 500-token capacity', async () => {
    const info = await enforceRateLimit('tenant-growth', 'growth');
    expect(info.limit).toBe(500);
    expect(info.remaining).toBe(499);
  });

  it.skipIf(!available)('scale plan gets 2000-token capacity', async () => {
    const info = await enforceRateLimit('tenant-scale', 'scale');
    expect(info.limit).toBe(2000);
    expect(info.remaining).toBe(1999);
  });

  // --- Unknown plan falls back to free ---

  it.skipIf(!available)('unknown plan falls back to free-tier limits', async () => {
    const info = await enforceRateLimit('tenant-unknown', 'enterprise');
    expect(info.limit).toBe(10);
    expect(info.remaining).toBe(9);
  });

  // --- Remaining count decrements correctly ---

  it.skipIf(!available)('remaining decrements on each consecutive call', async () => {
    const accountId = 'tenant-decrement';
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await enforceRateLimit(accountId, 'free'));
    }
    expect(results.map((r) => r.remaining)).toEqual([9, 8, 7, 6, 5]);
  });

  // --- Signup IP-based rate limit ---

  it.skipIf(!available)('enforces signup rate limit per IP', async () => {
    const ip = '192.168.1.1';
    for (let i = 0; i < 5; i++) {
      await enforceSignupRateLimit(ip);
    }
    try {
      await enforceSignupRateLimit(ip);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e.constructor.name).toBe('TooManyRequestsError');
    }
  });

  it.skipIf(!available)('different IPs have independent signup limits', async () => {
    for (let i = 0; i < 5; i++) {
      await enforceSignupRateLimit('10.0.0.1');
    }
    const info = await enforceSignupRateLimit('10.0.0.2');
    expect(info.remaining).toBe(4);
  });

  // --- Admin IP-based rate limit ---

  it.skipIf(!available)('enforces admin rate limit per IP', async () => {
    const info = await enforceAdminRateLimit('172.16.0.1');
    expect(info.limit).toBe(30);
    expect(info.remaining).toBe(29);
  });

  // --- Health IP-based rate limit ---

  it.skipIf(!available)('enforces health rate limit per IP', async () => {
    const info = await enforceHealthRateLimit('10.10.10.10');
    expect(info.limit).toBe(60);
    expect(info.remaining).toBe(59);
  });

  // --- Bucket state persists in DDB ---

  it.skipIf(!available)('persists bucket state across calls in DDB', async () => {
    const accountId = 'tenant-persist';
    await enforceRateLimit(accountId, 'free');
    await enforceRateLimit(accountId, 'free');
    await enforceRateLimit(accountId, 'free');

    const bucket = await rateLimitRepo.getBucket(accountId);
    expect(bucket.tokens).toBe(7);
    expect(bucket.lastRefillAt).toBeTruthy();
    expect(bucket.capacity).toBe(10);
    expect(bucket.refillRate).toBeCloseTo(10 / 60, 4);
  });

  // --- 429 does not consume additional tokens ---

  it.skipIf(!available)('does not consume tokens after bucket is empty', async () => {
    const accountId = 'tenant-no-extra';
    for (let i = 0; i < 10; i++) {
      await enforceRateLimit(accountId, 'free');
    }

    const bucketBefore = await rateLimitRepo.getBucket(accountId);

    try {
      await enforceRateLimit(accountId, 'free');
    } catch {
      /* expected 429 */
    }

    try {
      await enforceRateLimit(accountId, 'free');
    } catch {
      /* expected 429 */
    }

    const bucketAfter = await rateLimitRepo.getBucket(accountId);
    expect(bucketAfter.tokens).toBe(bucketBefore.tokens);
  });
});

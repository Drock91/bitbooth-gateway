import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { isLocalStackUp, createTable, destroyTable, ddbClient } from './helpers.js';
import { DynamoDBDocumentClient, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ScanCommand } from '@aws-sdk/client-dynamodb';

let available = false;
let usageRepo;

beforeAll(async () => {
  available = await isLocalStackUp();
  if (!available) return;
  await createTable('usage');
  const mod = await import('../../src/repositories/usage.repo.js');
  usageRepo = mod.usageRepo;
});

afterAll(async () => {
  if (available) await destroyTable('usage');
});

async function clearTable() {
  const res = await ddbClient.send(new ScanCommand({ TableName: 'x402-usage' }));
  if (!res.Items?.length) return;
  const docClient = DynamoDBDocumentClient.from(ddbClient);
  for (const item of res.Items) {
    await docClient.send(
      new DeleteCommand({
        TableName: 'x402-usage',
        Key: {
          accountId: item.accountId.S,
          yearMonth: item.yearMonth.S,
        },
      }),
    );
  }
}

function currentYearMonth() {
  return new Date().toISOString().slice(0, 7);
}

describe('usage.repo integration', () => {
  beforeEach(async () => {
    if (!available) return;
    vi.useRealTimers();
    await clearTable();
  });

  // --- increment: atomic create + update ---

  it.skipIf(!available)('creates a new usage row with callCount=1 on first paid call', async () => {
    const accountId = randomUUID();
    await usageRepo.increment(accountId, {
      resource: '/v1/quote',
      txHash: '0xabc',
    });

    const row = await usageRepo.getForPeriod(accountId, currentYearMonth());
    expect(row.callCount).toBe(1);
    expect(row.lastCallAt).toBeTruthy();
    expect(Array.from(row.resources ?? [])).toContain('/v1/quote');
    expect(Array.from(row.txHashes ?? [])).toContain('0xabc');
  });

  it.skipIf(!available)('increments callCount on subsequent paid calls', async () => {
    const accountId = randomUUID();
    for (let i = 0; i < 5; i++) {
      await usageRepo.increment(accountId, {
        resource: '/v1/quote',
        txHash: `0xtx-${i}`,
      });
    }

    const row = await usageRepo.getForPeriod(accountId, currentYearMonth());
    expect(row.callCount).toBe(5);
    expect(Array.from(row.txHashes)).toHaveLength(5);
  });

  it.skipIf(!available)('accumulates distinct resources across increments', async () => {
    const accountId = randomUUID();
    await usageRepo.increment(accountId, { resource: '/v1/quote', txHash: '0x1' });
    await usageRepo.increment(accountId, { resource: '/v1/resource', txHash: '0x2' });
    await usageRepo.increment(accountId, { resource: '/v1/fetch', txHash: '0x3' });

    const row = await usageRepo.getForPeriod(accountId, currentYearMonth());
    expect(row.callCount).toBe(3);
    const resources = Array.from(row.resources).sort();
    expect(resources).toEqual(['/v1/fetch', '/v1/quote', '/v1/resource']);
  });

  it.skipIf(!available)('dedupes repeated resource entries via DDB Set semantics', async () => {
    const accountId = randomUUID();
    await usageRepo.increment(accountId, { resource: '/v1/quote', txHash: '0xa' });
    await usageRepo.increment(accountId, { resource: '/v1/quote', txHash: '0xb' });
    await usageRepo.increment(accountId, { resource: '/v1/quote', txHash: '0xc' });

    const row = await usageRepo.getForPeriod(accountId, currentYearMonth());
    expect(row.callCount).toBe(3);
    expect(Array.from(row.resources)).toEqual(['/v1/quote']);
    expect(Array.from(row.txHashes).sort()).toEqual(['0xa', '0xb', '0xc']);
  });

  it.skipIf(!available)('updates lastCallAt on each increment', async () => {
    const accountId = randomUUID();
    await usageRepo.increment(accountId, { resource: '/v1/quote', txHash: '0x1' });
    const first = await usageRepo.getForPeriod(accountId, currentYearMonth());

    await new Promise((r) => setTimeout(r, 15));

    await usageRepo.increment(accountId, { resource: '/v1/quote', txHash: '0x2' });
    const second = await usageRepo.getForPeriod(accountId, currentYearMonth());

    expect(second.lastCallAt >= first.lastCallAt).toBe(true);
    expect(second.lastCallAt).not.toBe(first.lastCallAt);
  });

  // --- concurrency ---

  it.skipIf(!available)('concurrent increments produce the correct total callCount', async () => {
    const accountId = randomUUID();
    const N = 10;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        usageRepo.increment(accountId, {
          resource: '/v1/quote',
          txHash: `0xconc-${i}`,
        }),
      ),
    );

    const row = await usageRepo.getForPeriod(accountId, currentYearMonth());
    expect(row.callCount).toBe(N);
    expect(Array.from(row.txHashes)).toHaveLength(N);
  });

  it.skipIf(!available)('isolates counters across accounts', async () => {
    const a = randomUUID();
    const b = randomUUID();

    await usageRepo.increment(a, { resource: '/v1/quote', txHash: '0xa1' });
    await usageRepo.increment(a, { resource: '/v1/quote', txHash: '0xa2' });
    await usageRepo.increment(b, { resource: '/v1/quote', txHash: '0xb1' });

    const rowA = await usageRepo.getForPeriod(a, currentYearMonth());
    const rowB = await usageRepo.getForPeriod(b, currentYearMonth());

    expect(rowA.callCount).toBe(2);
    expect(rowB.callCount).toBe(1);
  });

  // --- month rollover ---

  it.skipIf(!available)('rolls over to a new yearMonth row when the month changes', async () => {
    const accountId = randomUUID();

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-31T23:59:50Z'));
    await usageRepo.increment(accountId, { resource: '/v1/quote', txHash: '0xmar' });

    vi.setSystemTime(new Date('2026-04-01T00:00:10Z'));
    await usageRepo.increment(accountId, { resource: '/v1/quote', txHash: '0xapr' });
    vi.useRealTimers();

    const march = await usageRepo.getForPeriod(accountId, '2026-03');
    const april = await usageRepo.getForPeriod(accountId, '2026-04');

    expect(march.callCount).toBe(1);
    expect(april.callCount).toBe(1);
    expect(Array.from(march.txHashes)).toEqual(['0xmar']);
    expect(Array.from(april.txHashes)).toEqual(['0xapr']);
  });

  it.skipIf(!available)('independent counters across three billing months', async () => {
    const accountId = randomUUID();

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-15T12:00:00Z'));
    await usageRepo.increment(accountId, { resource: '/v1/quote', txHash: '0xfeb' });
    await usageRepo.increment(accountId, { resource: '/v1/quote', txHash: '0xfeb2' });

    vi.setSystemTime(new Date('2026-03-10T12:00:00Z'));
    await usageRepo.increment(accountId, { resource: '/v1/quote', txHash: '0xmar' });

    vi.setSystemTime(new Date('2026-04-05T12:00:00Z'));
    await usageRepo.increment(accountId, { resource: '/v1/quote', txHash: '0xapr1' });
    await usageRepo.increment(accountId, { resource: '/v1/quote', txHash: '0xapr2' });
    await usageRepo.increment(accountId, { resource: '/v1/quote', txHash: '0xapr3' });
    vi.useRealTimers();

    expect((await usageRepo.getForPeriod(accountId, '2026-02')).callCount).toBe(2);
    expect((await usageRepo.getForPeriod(accountId, '2026-03')).callCount).toBe(1);
    expect((await usageRepo.getForPeriod(accountId, '2026-04')).callCount).toBe(3);
  });

  // --- getForPeriod ---

  it.skipIf(!available)('getForPeriod returns zero-count default for unknown account', async () => {
    const unknown = randomUUID();
    const row = await usageRepo.getForPeriod(unknown, '2026-04');
    expect(row).toEqual({ accountId: unknown, yearMonth: '2026-04', callCount: 0 });
  });

  it.skipIf(!available)('getForPeriod returns zero-count for wrong month', async () => {
    const accountId = randomUUID();
    await usageRepo.increment(accountId, { resource: '/v1/quote', txHash: '0xapr' });

    const row = await usageRepo.getForPeriod(accountId, '1999-01');
    expect(row.callCount).toBe(0);
  });

  // --- listByAccount ---

  it.skipIf(!available)('listByAccount returns rows in descending yearMonth order', async () => {
    const accountId = randomUUID();

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    await usageRepo.increment(accountId, { resource: '/v1/quote', txHash: '0xjan' });
    vi.setSystemTime(new Date('2026-02-15T12:00:00Z'));
    await usageRepo.increment(accountId, { resource: '/v1/quote', txHash: '0xfeb' });
    vi.setSystemTime(new Date('2026-03-15T12:00:00Z'));
    await usageRepo.increment(accountId, { resource: '/v1/quote', txHash: '0xmar' });
    vi.useRealTimers();

    const rows = await usageRepo.listByAccount(accountId);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.yearMonth)).toEqual(['2026-03', '2026-02', '2026-01']);
  });

  it.skipIf(!available)('listByAccount respects a custom limit', async () => {
    const accountId = randomUUID();

    vi.useFakeTimers();
    for (const ym of ['2026-01', '2026-02', '2026-03', '2026-04']) {
      vi.setSystemTime(new Date(`${ym}-15T12:00:00Z`));
      await usageRepo.increment(accountId, { resource: '/v1/quote', txHash: `0x${ym}` });
    }
    vi.useRealTimers();

    const rows = await usageRepo.listByAccount(accountId, 2);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.yearMonth)).toEqual(['2026-04', '2026-03']);
  });

  it.skipIf(!available)('listByAccount returns empty array for unknown account', async () => {
    const rows = await usageRepo.listByAccount(randomUUID());
    expect(rows).toEqual([]);
  });
});

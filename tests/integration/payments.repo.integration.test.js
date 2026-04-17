import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { isLocalStackUp, createTable, destroyTable, ddbClient } from './helpers.js';
import { DynamoDBDocumentClient, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ScanCommand } from '@aws-sdk/client-dynamodb';

let available = false;
let paymentsRepo;

const ACCOUNT_A = randomUUID();
const ACCOUNT_B = randomUUID();

function makePayment(overrides = {}) {
  return {
    idempotencyKey: randomUUID(),
    accountId: ACCOUNT_A,
    amountWei: '1000000',
    assetSymbol: 'USDC',
    txHash: '0x' + 'ab'.repeat(32),
    blockNumber: 42,
    ...overrides,
  };
}

beforeAll(async () => {
  available = await isLocalStackUp();
  if (!available) return;
  await createTable('payments');
  const mod = await import('../../src/repositories/payments.repo.js');
  paymentsRepo = mod.paymentsRepo;
});

afterAll(async () => {
  if (available) await destroyTable('payments');
});

async function clearTable() {
  const res = await ddbClient.send(new ScanCommand({ TableName: 'x402-payments' }));
  if (!res.Items?.length) return;
  const docClient = DynamoDBDocumentClient.from(ddbClient);
  for (const item of res.Items) {
    await docClient.send(
      new DeleteCommand({
        TableName: 'x402-payments',
        Key: { idempotencyKey: item.idempotencyKey.S },
      }),
    );
  }
}

describe('payments.repo integration', () => {
  beforeEach(async () => {
    if (!available) return;
    await clearTable();
  });

  // --- recordConfirmed ---

  it.skipIf(!available)('stores a confirmed payment', async () => {
    const input = makePayment();
    await paymentsRepo.recordConfirmed(input);

    const item = await paymentsRepo.getByNonce(input.idempotencyKey);
    expect(item).toBeDefined();
    expect(item.idempotencyKey).toBe(input.idempotencyKey);
    expect(item.accountId).toBe(input.accountId);
    expect(item.status).toBe('confirmed');
  });

  it.skipIf(!available)('persists all required fields', async () => {
    const input = makePayment();
    await paymentsRepo.recordConfirmed(input);

    const item = await paymentsRepo.getByNonce(input.idempotencyKey);
    expect(item.amountWei).toBe(input.amountWei);
    expect(item.assetSymbol).toBe(input.assetSymbol);
    expect(item.txHash).toBe(input.txHash);
    expect(item.blockNumber).toBe(input.blockNumber);
    expect(item.createdAt).toBeTruthy();
    expect(item.confirmedAt).toBeTruthy();
  });

  it.skipIf(!available)('throws ConflictError on duplicate idempotencyKey', async () => {
    const input = makePayment();
    await paymentsRepo.recordConfirmed(input);

    await expect(paymentsRepo.recordConfirmed(input)).rejects.toThrow('nonce already used');
  });

  it.skipIf(!available)('concurrent inserts with same key: one succeeds, one throws', async () => {
    const input = makePayment();
    const results = await Promise.allSettled([
      paymentsRepo.recordConfirmed(input),
      paymentsRepo.recordConfirmed(input),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.message).toMatch(/nonce already used/);
  });

  it.skipIf(!available)('allows different idempotencyKeys for same account', async () => {
    const a = makePayment();
    const b = makePayment();

    await paymentsRepo.recordConfirmed(a);
    await paymentsRepo.recordConfirmed(b);

    const itemA = await paymentsRepo.getByNonce(a.idempotencyKey);
    const itemB = await paymentsRepo.getByNonce(b.idempotencyKey);
    expect(itemA).toBeDefined();
    expect(itemB).toBeDefined();
  });

  // --- getByNonce ---

  it.skipIf(!available)('returns undefined for non-existent key', async () => {
    const item = await paymentsRepo.getByNonce(randomUUID());
    expect(item).toBeUndefined();
  });

  // --- listByAccount ---

  it.skipIf(!available)('returns empty array for unknown account', async () => {
    const result = await paymentsRepo.listByAccount(randomUUID());
    expect(result.items).toEqual([]);
    expect(result.lastKey).toBeNull();
  });

  it.skipIf(!available)('returns items for a known account', async () => {
    await paymentsRepo.recordConfirmed(makePayment({ accountId: ACCOUNT_A }));
    await paymentsRepo.recordConfirmed(makePayment({ accountId: ACCOUNT_A }));

    const result = await paymentsRepo.listByAccount(ACCOUNT_A);
    expect(result.items).toHaveLength(2);
    result.items.forEach((item) => expect(item.accountId).toBe(ACCOUNT_A));
  });

  it.skipIf(!available)('isolates accounts from each other', async () => {
    await paymentsRepo.recordConfirmed(makePayment({ accountId: ACCOUNT_A }));
    await paymentsRepo.recordConfirmed(makePayment({ accountId: ACCOUNT_B }));

    const resultA = await paymentsRepo.listByAccount(ACCOUNT_A);
    const resultB = await paymentsRepo.listByAccount(ACCOUNT_B);

    expect(resultA.items).toHaveLength(1);
    expect(resultA.items[0].accountId).toBe(ACCOUNT_A);
    expect(resultB.items).toHaveLength(1);
    expect(resultB.items[0].accountId).toBe(ACCOUNT_B);
  });

  it.skipIf(!available)('respects limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      await paymentsRepo.recordConfirmed(makePayment({ accountId: ACCOUNT_A }));
    }

    const result = await paymentsRepo.listByAccount(ACCOUNT_A, 3);
    expect(result.items).toHaveLength(3);
    expect(result.lastKey).not.toBeNull();
  });

  it.skipIf(!available)('supports cursor-based pagination', async () => {
    for (let i = 0; i < 5; i++) {
      await paymentsRepo.recordConfirmed(makePayment({ accountId: ACCOUNT_A }));
    }

    const page1 = await paymentsRepo.listByAccount(ACCOUNT_A, 3);
    expect(page1.items).toHaveLength(3);
    expect(page1.lastKey).not.toBeNull();

    const page2 = await paymentsRepo.listByAccount(ACCOUNT_A, 3, page1.lastKey);
    expect(page2.items).toHaveLength(2);
    expect(page2.lastKey).toBeNull();
  });

  it.skipIf(!available)('paginates through all items across pages', async () => {
    for (let i = 0; i < 7; i++) {
      await paymentsRepo.recordConfirmed(makePayment({ accountId: ACCOUNT_A }));
    }

    const allItems = [];
    let cursor = undefined;
    do {
      const page = await paymentsRepo.listByAccount(ACCOUNT_A, 2, cursor);
      allItems.push(...page.items);
      cursor = page.lastKey;
    } while (cursor);

    expect(allItems).toHaveLength(7);
    const keys = new Set(allItems.map((i) => i.idempotencyKey));
    expect(keys.size).toBe(7);
  });

  // --- full lifecycle ---

  it.skipIf(!available)('record → get → list round-trip', async () => {
    const input = makePayment({ accountId: ACCOUNT_A });
    await paymentsRepo.recordConfirmed(input);

    const byKey = await paymentsRepo.getByNonce(input.idempotencyKey);
    expect(byKey.idempotencyKey).toBe(input.idempotencyKey);

    const list = await paymentsRepo.listByAccount(ACCOUNT_A);
    expect(list.items.some((i) => i.idempotencyKey === input.idempotencyKey)).toBe(true);
  });
});

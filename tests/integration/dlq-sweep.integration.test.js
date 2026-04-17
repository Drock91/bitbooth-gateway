import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  DeleteCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import { isLocalStackUp, createTable, destroyTable, ddbClient } from './helpers.js';
import { randomUUID } from 'node:crypto';

const mockVerifyWebhook = vi.fn();
vi.mock('../../src/services/routing.service.js', () => ({
  getAdapter: () => ({ verifyWebhook: mockVerifyWebhook }),
}));

vi.mock('../../src/lib/metrics.js', () => ({
  emitMetric: vi.fn(),
}));

let available = false;
let webhookDlqRepo;
let sweepDlq;
const docClient = DynamoDBDocumentClient.from(ddbClient);
const TABLE_NAME = 'x402-webhook-dlq';

async function clearTable() {
  const res = await ddbClient.send(new ScanCommand({ TableName: TABLE_NAME }));
  if (!res.Items?.length) return;
  for (const item of res.Items) {
    const eventId = item.eventId?.S ?? item.eventId;
    await docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { eventId } }));
  }
}

function makeEntry(overrides = {}) {
  return {
    eventId: randomUUID(),
    provider: 'coinbase',
    payload: '{"type":"charge:completed"}',
    headers: { 'x-cc-webhook-signature': 'sig123' },
    errorMessage: 'verification failed',
    errorCode: 'HMAC_MISMATCH',
    ...overrides,
  };
}

beforeAll(async () => {
  available = await isLocalStackUp();
  if (!available) return;

  process.env.WEBHOOK_DLQ_TABLE = TABLE_NAME;
  process.env.DLQ_MAX_RETRIES = '3';
  process.env.DLQ_BASE_DELAY_MS = '1'; // 1ms for fast tests
  process.env.DLQ_MAX_DELAY_MS = '100';

  await createTable('webhook-dlq');

  const repoMod = await import('../../src/repositories/webhook-dlq.repo.js');
  webhookDlqRepo = repoMod.webhookDlqRepo;

  const serviceMod = await import('../../src/services/webhook-dlq.service.js');
  sweepDlq = serviceMod.sweepDlq;
});

afterAll(async () => {
  if (!available) return;
  await destroyTable('webhook-dlq');
  delete process.env.WEBHOOK_DLQ_TABLE;
  delete process.env.DLQ_MAX_RETRIES;
  delete process.env.DLQ_BASE_DELAY_MS;
  delete process.env.DLQ_MAX_DELAY_MS;
});

describe('DLQ sweep integration', () => {
  beforeEach(async () => {
    if (!available) return;
    vi.clearAllMocks();
    await clearTable();
  });

  // --- Record → sweep with successful retry → resolved ---

  it.skipIf(!available)(
    'records a failed event and sweeps it to resolved on successful retry',
    async () => {
      const entry = makeEntry();
      await webhookDlqRepo.record(entry);

      mockVerifyWebhook.mockResolvedValueOnce({ verified: true });

      const result = await sweepDlq();

      expect(result.processed).toBe(1);
      expect(result.retried).toBe(1);
      expect(result.exhausted).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.skipped).toBe(0);

      // Verify item is now resolved in DDB
      const item = await docClient.send(
        new GetCommand({ TableName: TABLE_NAME, Key: { eventId: entry.eventId } }),
      );
      expect(item.Item.status).toBe('resolved');
      expect(mockVerifyWebhook).toHaveBeenCalledOnce();
    },
  );

  // --- Record → sweep with failed retry → incremented retryCount ---

  it.skipIf(!available)('increments retryCount when adapter retry fails', async () => {
    const entry = makeEntry();
    await webhookDlqRepo.record(entry);

    mockVerifyWebhook.mockRejectedValueOnce(new Error('still bad'));

    const result = await sweepDlq();

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.retried).toBe(0);

    const item = await docClient.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { eventId: entry.eventId } }),
    );
    expect(item.Item.status).toBe('pending');
    expect(item.Item.retryCount).toBe(1);
  });

  // --- Exhausted retries → resolved without calling adapter ---

  it.skipIf(!available)(
    'marks entry as resolved when retries exhausted (MAX_RETRIES=3)',
    async () => {
      const entry = makeEntry();
      const recorded = await webhookDlqRepo.record(entry);

      // Manually increment retryCount to MAX_RETRIES (3)
      for (let i = 0; i < 3; i++) {
        await webhookDlqRepo.incrementRetry(recorded.eventId);
      }

      const result = await sweepDlq();

      expect(result.processed).toBe(1);
      expect(result.exhausted).toBe(1);
      expect(result.retried).toBe(0);
      expect(result.failed).toBe(0);

      // Adapter should NOT have been called
      expect(mockVerifyWebhook).not.toHaveBeenCalled();

      const item = await docClient.send(
        new GetCommand({ TableName: TABLE_NAME, Key: { eventId: entry.eventId } }),
      );
      expect(item.Item.status).toBe('resolved');
    },
  );

  // --- Multiple entries with mixed outcomes ---

  it.skipIf(!available)(
    'handles mixed batch: one resolved, one failed, one exhausted',
    async () => {
      // Entry 1: will succeed on retry
      const e1 = makeEntry({ eventId: randomUUID() });
      await webhookDlqRepo.record(e1);

      // Entry 2: will fail on retry
      const e2 = makeEntry({ eventId: randomUUID() });
      await webhookDlqRepo.record(e2);

      // Entry 3: already at max retries → exhausted
      const e3 = makeEntry({ eventId: randomUUID() });
      const rec3 = await webhookDlqRepo.record(e3);
      for (let i = 0; i < 3; i++) {
        await webhookDlqRepo.incrementRetry(rec3.eventId);
      }

      mockVerifyWebhook
        .mockResolvedValueOnce({ verified: true })
        .mockRejectedValueOnce(new Error('bad'));

      const result = await sweepDlq();

      expect(result.processed).toBe(3);
      expect(result.retried).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.exhausted).toBe(1);

      const i1 = await docClient.send(
        new GetCommand({ TableName: TABLE_NAME, Key: { eventId: e1.eventId } }),
      );
      const i2 = await docClient.send(
        new GetCommand({ TableName: TABLE_NAME, Key: { eventId: e2.eventId } }),
      );
      const i3 = await docClient.send(
        new GetCommand({ TableName: TABLE_NAME, Key: { eventId: e3.eventId } }),
      );

      expect(i1.Item.status).toBe('resolved');
      expect(i2.Item.status).toBe('pending');
      expect(i2.Item.retryCount).toBe(1);
      expect(i3.Item.status).toBe('resolved');
    },
  );

  // --- Empty DLQ → no-op ---

  it.skipIf(!available)('returns zeros when DLQ is empty', async () => {
    const result = await sweepDlq();

    expect(result).toEqual({
      processed: 0,
      retried: 0,
      exhausted: 0,
      skipped: 0,
      failed: 0,
    });
    expect(mockVerifyWebhook).not.toHaveBeenCalled();
  });

  // --- Already resolved entries are not re-processed ---

  it.skipIf(!available)('does not re-process already resolved entries', async () => {
    const entry = makeEntry();
    const recorded = await webhookDlqRepo.record(entry);
    await webhookDlqRepo.updateStatus(recorded.eventId, 'resolved');

    const result = await sweepDlq();

    // listPending only returns 'pending' status, so resolved entries are invisible
    expect(result.processed).toBe(0);
    expect(mockVerifyWebhook).not.toHaveBeenCalled();
  });

  // --- Successive sweeps: fail then succeed ---

  it.skipIf(!available)('retries an entry across two successive sweeps', async () => {
    const entry = makeEntry();
    await webhookDlqRepo.record(entry);

    // First sweep: retry fails
    mockVerifyWebhook.mockRejectedValueOnce(new Error('transient'));
    const r1 = await sweepDlq();
    expect(r1.failed).toBe(1);

    // Second sweep: retry succeeds
    mockVerifyWebhook.mockResolvedValueOnce({ verified: true });
    const r2 = await sweepDlq();
    expect(r2.retried).toBe(1);

    const item = await docClient.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { eventId: entry.eventId } }),
    );
    expect(item.Item.status).toBe('resolved');
    expect(item.Item.retryCount).toBe(1);
  });

  // --- Multiple providers in the same batch ---

  it.skipIf(!available)('sweeps entries from different providers', async () => {
    const e1 = makeEntry({ provider: 'coinbase' });
    const e2 = makeEntry({ provider: 'moonpay' });
    await webhookDlqRepo.record(e1);
    await webhookDlqRepo.record(e2);

    mockVerifyWebhook.mockResolvedValue({ verified: true });

    const result = await sweepDlq();

    expect(result.processed).toBe(2);
    expect(result.retried).toBe(2);
    expect(mockVerifyWebhook).toHaveBeenCalledTimes(2);
  });

  // --- Retry count persists correctly through multiple failed sweeps ---

  it.skipIf(!available)('increments retryCount through 3 failed sweeps then exhausts', async () => {
    const entry = makeEntry();
    await webhookDlqRepo.record(entry);

    mockVerifyWebhook.mockRejectedValue(new Error('always fails'));

    // 3 sweeps fail (MAX_RETRIES=3)
    for (let i = 0; i < 3; i++) {
      const r = await sweepDlq();
      expect(r.failed).toBe(1);
    }

    // 4th sweep should exhaust (retryCount=3 >= MAX_RETRIES=3)
    const r4 = await sweepDlq();
    expect(r4.exhausted).toBe(1);
    expect(r4.failed).toBe(0);

    const item = await docClient.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { eventId: entry.eventId } }),
    );
    expect(item.Item.status).toBe('resolved');
  });

  // --- Record preserves all fields ---

  it.skipIf(!available)('persists all DLQ entry fields correctly', async () => {
    const entry = makeEntry({
      provider: 'kraken',
      payload: '{"event":"deposit"}',
      headers: { 'x-kraken-sig': 'abc' },
      errorMessage: 'sig mismatch',
      errorCode: 'SIG_INVALID',
    });
    await webhookDlqRepo.record(entry);

    const item = await docClient.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { eventId: entry.eventId } }),
    );

    expect(item.Item.eventId).toBe(entry.eventId);
    expect(item.Item.provider).toBe('kraken');
    expect(item.Item.payload).toBe('{"event":"deposit"}');
    expect(item.Item.headers).toEqual({ 'x-kraken-sig': 'abc' });
    expect(item.Item.errorMessage).toBe('sig mismatch');
    expect(item.Item.errorCode).toBe('SIG_INVALID');
    expect(item.Item.status).toBe('pending');
    expect(item.Item.retryCount).toBe(0);
    expect(item.Item.createdAt).toBeTruthy();
    expect(item.Item.updatedAt).toBeTruthy();
    expect(item.Item.ttl).toBeTypeOf('number');
  });

  // --- Verify adapter receives correct payload and headers ---

  it.skipIf(!available)('passes stored payload and headers to adapter verifyWebhook', async () => {
    const entry = makeEntry({
      payload: '{"amount":"100"}',
      headers: { 'x-sig': 'deadbeef' },
    });
    await webhookDlqRepo.record(entry);

    mockVerifyWebhook.mockResolvedValueOnce({ verified: true });
    await sweepDlq();

    expect(mockVerifyWebhook).toHaveBeenCalledWith('{"amount":"100"}', { 'x-sig': 'deadbeef' });
  });

  // --- listByProvider returns entries for a specific provider ---

  it.skipIf(!available)('listByProvider filters by provider correctly', async () => {
    await webhookDlqRepo.record(makeEntry({ provider: 'coinbase' }));
    await webhookDlqRepo.record(makeEntry({ provider: 'coinbase' }));
    await webhookDlqRepo.record(makeEntry({ provider: 'moonpay' }));

    const { items: coinbaseItems } = await webhookDlqRepo.listByProvider('coinbase');
    const { items: moonpayItems } = await webhookDlqRepo.listByProvider('moonpay');

    expect(coinbaseItems.length).toBe(2);
    expect(moonpayItems.length).toBe(1);
    expect(coinbaseItems.every((i) => i.provider === 'coinbase')).toBe(true);
    expect(moonpayItems[0].provider).toBe('moonpay');
  });
});

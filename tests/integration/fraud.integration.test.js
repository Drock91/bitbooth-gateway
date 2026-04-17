import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { DynamoDBDocumentClient, ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { isLocalStackUp, createTable, destroyTable, ddbClient } from './helpers.js';

vi.mock('../../src/lib/metrics.js', () => ({
  emitMetric: vi.fn(),
  paymentVerified: vi.fn(),
  paymentFailed: vi.fn(),
}));

let available = false;
let fraudRepo;
let fraudService;
let FraudDetectedError;
const docClient = DynamoDBDocumentClient.from(ddbClient);

const TALLY_TABLE = 'x402-fraud-tally';
const EVENTS_TABLE = 'x402-fraud-events';

async function clearTable(tableName, keys) {
  const res = await ddbClient.send(new ScanCommand({ TableName: tableName }));
  if (!res.Items?.length) return;
  for (const item of res.Items) {
    const key = {};
    for (const k of keys) key[k] = item[k];
    await docClient.send(new DeleteCommand({ TableName: tableName, Key: key }));
  }
}

async function clearAll() {
  await Promise.all([
    clearTable(TALLY_TABLE, ['accountId', 'windowKey']),
    clearTable(EVENTS_TABLE, ['accountId', 'timestamp']),
  ]);
}

beforeAll(async () => {
  available = await isLocalStackUp();
  if (!available) return;

  await Promise.all([createTable('fraud-tally'), createTable('fraud-events')]);

  const repo = await import('../../src/repositories/fraud.repo.js');
  fraudRepo = repo.fraudRepo;

  const svc = await import('../../src/services/fraud.service.js');
  fraudService = svc.fraudService;

  const errors = await import('../../src/lib/errors.js');
  FraudDetectedError = errors.FraudDetectedError;
});

afterAll(async () => {
  if (!available) return;
  await Promise.all([destroyTable('fraud-tally'), destroyTable('fraud-events')]);
});

describe('fraud detection integration', () => {
  beforeEach(async () => {
    if (!available) return;
    await clearAll();
  });

  // --- Tally: atomic increment ---

  it.skipIf(!available)('incrementTally creates tally with count 1 on first call', async () => {
    const result = await fraudRepo.incrementTally('acct-1', 'velocity:2026-04-11T12:00');
    expect(result.accountId).toBe('acct-1');
    expect(result.windowKey).toBe('velocity:2026-04-11T12:00');
    expect(result.eventCount).toBe(1);
    expect(result.lastEventAt).toBeTruthy();
  });

  it.skipIf(!available)('incrementTally increments atomically on repeated calls', async () => {
    const key = 'velocity:2026-04-11T12:01';
    await fraudRepo.incrementTally('acct-2', key);
    await fraudRepo.incrementTally('acct-2', key);
    const result = await fraudRepo.incrementTally('acct-2', key);
    expect(result.eventCount).toBe(3);
  });

  it.skipIf(!available)('concurrent increments are sequenced correctly', async () => {
    const key = 'velocity:2026-04-11T12:02';
    await Promise.all(Array.from({ length: 5 }, () => fraudRepo.incrementTally('acct-conc', key)));
    const tally = await fraudRepo.getTally('acct-conc', key);
    expect(tally.eventCount).toBe(5);
  });

  // --- Tally: getTally ---

  it.skipIf(!available)('getTally returns zero for missing window', async () => {
    const tally = await fraudRepo.getTally('acct-missing', 'velocity:2026-01-01T00:00');
    expect(tally.eventCount).toBe(0);
    expect(tally.accountId).toBe('acct-missing');
  });

  it.skipIf(!available)('getTally returns stored count for existing window', async () => {
    const key = 'velocity:2026-04-11T12:03';
    await fraudRepo.incrementTally('acct-get', key);
    await fraudRepo.incrementTally('acct-get', key);
    const tally = await fraudRepo.getTally('acct-get', key);
    expect(tally.eventCount).toBe(2);
  });

  // --- Events: record + list ---

  it.skipIf(!available)('recordEvent persists event with TTL', async () => {
    const event = await fraudRepo.recordEvent({
      accountId: 'acct-evt',
      eventType: 'high_velocity',
      severity: 'high',
      details: { window: '1m', count: 6, limit: 5 },
    });
    expect(event.accountId).toBe('acct-evt');
    expect(event.eventType).toBe('high_velocity');
    expect(event.ttl).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it.skipIf(!available)('listByAccount returns events newest first', async () => {
    for (let i = 0; i < 3; i++) {
      await fraudRepo.recordEvent({
        accountId: 'acct-list',
        eventType: 'high_velocity',
        severity: 'medium',
        details: { seq: i },
      });
    }
    const events = await fraudRepo.listByAccount('acct-list');
    expect(events).toHaveLength(3);
    expect(events[0].timestamp >= events[1].timestamp).toBe(true);
    expect(events[1].timestamp >= events[2].timestamp).toBe(true);
  });

  it.skipIf(!available)('listByAccount isolates by account', async () => {
    await fraudRepo.recordEvent({
      accountId: 'acct-A',
      eventType: 'abnormal_amount',
      severity: 'high',
      details: { amountWei: '999' },
    });
    await fraudRepo.recordEvent({
      accountId: 'acct-B',
      eventType: 'high_velocity',
      severity: 'medium',
      details: { window: '1h' },
    });
    const eventsA = await fraudRepo.listByAccount('acct-A');
    const eventsB = await fraudRepo.listByAccount('acct-B');
    expect(eventsA).toHaveLength(1);
    expect(eventsB).toHaveLength(1);
    expect(eventsA[0].accountId).toBe('acct-A');
    expect(eventsB[0].accountId).toBe('acct-B');
  });

  // --- Service: checkPrePayment velocity (minute) ---

  it.skipIf(!available)(
    'checkPrePayment throws FraudDetectedError on minute velocity breach',
    async () => {
      const accountId = 'acct-vel-min';
      const rules = { maxPaymentsPerMinute: 2, maxPaymentsPerHour: 100 };
      await fraudService.checkPrePayment({ accountId, amountWei: '5000', fraudRules: rules });
      await fraudService.checkPrePayment({ accountId, amountWei: '5000', fraudRules: rules });

      try {
        await fraudService.checkPrePayment({ accountId, amountWei: '5000', fraudRules: rules });
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(FraudDetectedError);
        expect(e.details.rule).toBe('high_velocity');
        expect(e.details.window).toBe('1m');
      }
    },
  );

  // --- Service: checkPrePayment velocity (hour) ---

  it.skipIf(!available)(
    'checkPrePayment throws FraudDetectedError on hour velocity breach',
    async () => {
      const accountId = 'acct-vel-hr';
      const rules = { maxPaymentsPerMinute: 100, maxPaymentsPerHour: 2 };
      await fraudService.checkPrePayment({ accountId, amountWei: '5000', fraudRules: rules });
      await fraudService.checkPrePayment({ accountId, amountWei: '5000', fraudRules: rules });

      try {
        await fraudService.checkPrePayment({ accountId, amountWei: '5000', fraudRules: rules });
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(FraudDetectedError);
        expect(e.details.rule).toBe('high_velocity');
        expect(e.details.window).toBe('1h');
      }
    },
  );

  // --- Service: amount bounds ---

  it.skipIf(!available)('checkPrePayment throws on amount below min', async () => {
    try {
      await fraudService.checkPrePayment({
        accountId: 'acct-amt-low',
        amountWei: '500',
        fraudRules: { minAmountWei: '1000', maxAmountWei: '100000' },
      });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(FraudDetectedError);
      expect(e.details.rule).toBe('abnormal_amount');
    }
  });

  it.skipIf(!available)('checkPrePayment throws on amount above max', async () => {
    try {
      await fraudService.checkPrePayment({
        accountId: 'acct-amt-high',
        amountWei: '200000',
        fraudRules: { minAmountWei: '1000', maxAmountWei: '100000' },
      });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(FraudDetectedError);
      expect(e.details.rule).toBe('abnormal_amount');
    }
  });

  it.skipIf(!available)('checkPrePayment passes at exact min boundary', async () => {
    await expect(
      fraudService.checkPrePayment({
        accountId: 'acct-amt-min',
        amountWei: '1000',
        fraudRules: { minAmountWei: '1000', maxAmountWei: '100000' },
      }),
    ).resolves.toBeUndefined();
  });

  it.skipIf(!available)('checkPrePayment passes at exact max boundary', async () => {
    await expect(
      fraudService.checkPrePayment({
        accountId: 'acct-amt-max',
        amountWei: '100000',
        fraudRules: { minAmountWei: '1000', maxAmountWei: '100000' },
      }),
    ).resolves.toBeUndefined();
  });

  // --- Service: nonce failure tracking ---

  it.skipIf(!available)('trackNonceFailure throws after exceeding threshold', async () => {
    const accountId = 'acct-nonce';
    const rules = { maxNonceFailuresPerMinute: 2 };
    await fraudService.trackNonceFailure(accountId, rules);
    await fraudService.trackNonceFailure(accountId, rules);

    try {
      await fraudService.trackNonceFailure(accountId, rules);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(FraudDetectedError);
      expect(e.details.rule).toBe('repeated_nonce_failure');
      expect(e.details.count).toBe(3);
    }
  });

  it.skipIf(!available)('trackNonceFailure records fraud event on breach', async () => {
    const accountId = 'acct-nonce-evt';
    const rules = { maxNonceFailuresPerMinute: 1 };
    await fraudService.trackNonceFailure(accountId, rules);

    try {
      await fraudService.trackNonceFailure(accountId, rules);
    } catch {
      /* expected */
    }

    const events = await fraudRepo.listByAccount(accountId);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].eventType).toBe('repeated_nonce_failure');
    expect(events[0].severity).toBe('high');
  });

  // --- Per-route rule overrides ---

  it.skipIf(!available)('per-route fraud rules override defaults', async () => {
    const accountId = 'acct-override';
    const strictRules = { maxPaymentsPerMinute: 1, maxPaymentsPerHour: 100 };
    await fraudService.checkPrePayment({ accountId, amountWei: '5000', fraudRules: strictRules });

    try {
      await fraudService.checkPrePayment({
        accountId,
        amountWei: '5000',
        fraudRules: strictRules,
      });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(FraudDetectedError);
    }
  });

  // --- Account isolation ---

  it.skipIf(!available)('tallies are independent per account', async () => {
    const rules = { maxPaymentsPerMinute: 2, maxPaymentsPerHour: 100 };
    await fraudService.checkPrePayment({
      accountId: 'acct-iso-1',
      amountWei: '5000',
      fraudRules: rules,
    });
    await fraudService.checkPrePayment({
      accountId: 'acct-iso-1',
      amountWei: '5000',
      fraudRules: rules,
    });

    await expect(
      fraudService.checkPrePayment({
        accountId: 'acct-iso-2',
        amountWei: '5000',
        fraudRules: rules,
      }),
    ).resolves.toBeUndefined();
  });
});

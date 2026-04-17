import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  DeleteCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import { isLocalStackUp, createTable, destroyTable, ddbClient } from './helpers.js';

const MOCK_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const MOCK_TX_HASH = '0x' + 'ab'.repeat(32);
const MOCK_NONCE = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';

let nonceCounter = 0;
vi.mock('../../src/lib/crypto.js', () => ({
  newNonce: () => `${MOCK_NONCE}${String(nonceCounter++).padStart(4, '0')}`,
  hmacSha256: (key, body) => {
    const { createHmac } = require('node:crypto');
    return createHmac('sha256', key).update(body).digest('hex');
  },
  sha256: (input) => {
    const { createHash } = require('node:crypto');
    return createHash('sha256').update(input).digest('hex');
  },
  safeEquals: (a, b) => a === b,
}));

const mockVerifyPayment = vi.fn();
const mockGetAgentAddress = vi.fn(() => Promise.resolve(MOCK_ADDRESS));

vi.mock('../../src/adapters/xrpl-evm/index.js', () => ({
  verifyPayment: mockVerifyPayment,
  getAgentAddress: mockGetAgentAddress,
}));

vi.mock('../../src/lib/metrics.js', () => ({
  paymentVerified: vi.fn(),
  paymentFailed: vi.fn(),
  emitMetric: vi.fn(),
}));

let available = false;
let enforceX402;
const docClient = DynamoDBDocumentClient.from(ddbClient);

const TABLES = ['payments', 'usage', 'fraud-tally', 'fraud-events'];

async function clearTable(tableName) {
  const res = await ddbClient.send(new ScanCommand({ TableName: tableName }));
  if (!res.Items?.length) return;
  for (const item of res.Items) {
    const key = {};
    for (const [k, v] of Object.entries(item)) {
      if (v.S !== undefined) key[k] = v.S;
      else if (v.N !== undefined) key[k] = Number(v.N);
    }
    // Only keep key attributes
    const tableDefs = {
      'x402-payments': ['idempotencyKey'],
      'x402-usage': ['accountId', 'yearMonth'],
      'x402-fraud-tally': ['accountId', 'windowKey'],
      'x402-fraud-events': ['accountId', 'timestamp'],
    };
    const keyAttrs = tableDefs[tableName] ?? [];
    const keyOnly = {};
    for (const attr of keyAttrs) {
      keyOnly[attr] = key[attr];
    }
    await docClient.send(new DeleteCommand({ TableName: tableName, Key: keyOnly }));
  }
}

function makeRoute(overrides = {}) {
  return {
    amountWei: '5000000',
    assetSymbol: 'USDC',
    resource: '/v1/data',
    fraudRules: {},
    ...overrides,
  };
}

function validHeader(overrides = {}) {
  return JSON.stringify({
    nonce: 'a'.repeat(16),
    txHash: MOCK_TX_HASH,
    signature: 'sig123',
    ...overrides,
  });
}

function makeInput(headerValue, accountId = 'acct-integ-1') {
  return {
    headers: headerValue != null ? { 'x-payment': headerValue } : {},
    route: makeRoute(),
    accountId,
  };
}

beforeAll(async () => {
  available = await isLocalStackUp();
  if (!available) return;

  for (const t of TABLES) {
    await createTable(t);
  }

  const mod = await import('../../src/middleware/x402.middleware.js');
  enforceX402 = mod.enforceX402;
});

afterAll(async () => {
  if (!available) return;
  for (const t of TABLES) {
    await destroyTable(t);
  }
});

describe('x402 full payment flow integration', () => {
  beforeEach(async () => {
    if (!available) return;
    vi.clearAllMocks();
    mockGetAgentAddress.mockResolvedValue(MOCK_ADDRESS);
    nonceCounter = 0;
    for (const t of TABLES) {
      const tableName = `x402-${t}`;
      await clearTable(tableName);
    }
  });

  // --- Challenge issuance (no header) ---

  it.skipIf(!available)('returns 402 challenge when no X-PAYMENT header', async () => {
    const input = makeInput(null);
    try {
      await enforceX402(input);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e.constructor.name).toBe('PaymentRequiredError');
      const c = e.challenge;
      expect(c.payTo).toBe(MOCK_ADDRESS);
      expect(c.amountWei).toBe('5000000');
      expect(c.assetSymbol).toBe('USDC');
      expect(c.chainId).toBe(8453);
      expect(c.resource).toBe('/v1/data');
      expect(c.nonce).toBeTruthy();
      expect(c.expiresAt).toBeTypeOf('number');
    }
  });

  // --- Happy path: challenge → payment verification → DDB persistence ---

  it.skipIf(!available)(
    'verifies payment, persists to payments table, increments usage',
    async () => {
      mockVerifyPayment.mockResolvedValueOnce({ ok: true, blockNumber: 42 });

      const nonce = 'abcdef1234567890';
      const input = makeInput(validHeader({ nonce }));
      const result = await enforceX402(input);

      expect(result).toEqual({ paid: true, txHash: MOCK_TX_HASH });

      // Payment recorded in DDB
      const payment = await docClient.send(
        new GetCommand({ TableName: 'x402-payments', Key: { idempotencyKey: nonce } }),
      );
      expect(payment.Item).toBeTruthy();
      expect(payment.Item.accountId).toBe('acct-integ-1');
      expect(payment.Item.txHash).toBe(MOCK_TX_HASH);
      expect(payment.Item.blockNumber).toBe(42);
      expect(payment.Item.status).toBe('confirmed');
      expect(payment.Item.amountWei).toBe('5000000');

      // Usage incremented
      const yearMonth = new Date().toISOString().slice(0, 7);
      const usage = await docClient.send(
        new GetCommand({ TableName: 'x402-usage', Key: { accountId: 'acct-integ-1', yearMonth } }),
      );
      expect(usage.Item).toBeTruthy();
      expect(usage.Item.callCount).toBe(1);
    },
  );

  // --- Nonce reuse: second call with same nonce rejected ---

  it.skipIf(!available)('rejects nonce reuse after a successful payment', async () => {
    mockVerifyPayment.mockResolvedValueOnce({ ok: true, blockNumber: 10 });

    const nonce = 'reuse_test_nonce1';
    const input = makeInput(validHeader({ nonce }));
    await enforceX402(input);

    // Second call with same nonce
    try {
      await enforceX402(makeInput(validHeader({ nonce })));
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e.constructor.name).toBe('PaymentRequiredError');
      // Should get a fresh challenge, not the old data
      expect(e.challenge.nonce).toBeTruthy();
      expect(e.challenge.payTo).toBe(MOCK_ADDRESS);
    }

    // Usage should only be 1 (not 2)
    const yearMonth = new Date().toISOString().slice(0, 7);
    const usage = await docClient.send(
      new GetCommand({ TableName: 'x402-usage', Key: { accountId: 'acct-integ-1', yearMonth } }),
    );
    expect(usage.Item.callCount).toBe(1);
  });

  // --- Chain verification failure ---

  it.skipIf(!available)('rejects when chain verification returns ok:false', async () => {
    mockVerifyPayment.mockResolvedValueOnce({ ok: false, reason: 'wrong-recipient' });

    const input = makeInput(validHeader({ nonce: 'fail_verify_nonce' }));
    try {
      await enforceX402(input);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e.constructor.name).toBe('PaymentRequiredError');
      expect(e.challenge.reason).toBe('wrong-recipient');
    }

    // No payment recorded
    const payment = await docClient.send(
      new GetCommand({ TableName: 'x402-payments', Key: { idempotencyKey: 'fail_verify_nonce' } }),
    );
    expect(payment.Item).toBeUndefined();
  });

  // --- Invalid header ---

  it.skipIf(!available)('rejects malformed X-PAYMENT header with ValidationError', async () => {
    const input = makeInput('not-valid-json');
    try {
      await enforceX402(input);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e.constructor.name).toBe('ValidationError');
    }
  });

  it.skipIf(!available)('rejects header that fails Zod schema', async () => {
    const input = makeInput(JSON.stringify({ nonce: 'short', txHash: 'bad', signature: '' }));
    try {
      await enforceX402(input);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e.constructor.name).toBe('ValidationError');
    }
  });

  // --- Multiple sequential payments ---

  it.skipIf(!available)('handles multiple sequential payments with different nonces', async () => {
    mockVerifyPayment.mockResolvedValue({ ok: true, blockNumber: 100 });

    const nonces = ['seq_nonce_aaaaaa1', 'seq_nonce_aaaaaa2', 'seq_nonce_aaaaaa3'];
    for (const nonce of nonces) {
      const result = await enforceX402(makeInput(validHeader({ nonce })));
      expect(result.paid).toBe(true);
    }

    // All 3 payments recorded
    for (const nonce of nonces) {
      const payment = await docClient.send(
        new GetCommand({ TableName: 'x402-payments', Key: { idempotencyKey: nonce } }),
      );
      expect(payment.Item).toBeTruthy();
      expect(payment.Item.status).toBe('confirmed');
    }

    // Usage count is 3
    const yearMonth = new Date().toISOString().slice(0, 7);
    const usage = await docClient.send(
      new GetCommand({ TableName: 'x402-usage', Key: { accountId: 'acct-integ-1', yearMonth } }),
    );
    expect(usage.Item.callCount).toBe(3);
  });

  // --- Fraud detection integration ---

  it.skipIf(!available)('records fraud tally increments during payment flow', async () => {
    mockVerifyPayment.mockResolvedValue({ ok: true, blockNumber: 55 });

    // Make a valid payment — fraud service should increment velocity tally
    const input = makeInput(validHeader({ nonce: 'fraud_tally_nonce' }));
    await enforceX402(input);

    // Fraud tally table should have velocity entries for this account
    const scan = await ddbClient.send(new ScanCommand({ TableName: 'x402-fraud-tally' }));
    const tallies = scan.Items ?? [];
    expect(tallies.length).toBeGreaterThan(0);
    const acctTallies = tallies.filter((i) => i.accountId?.S === 'acct-integ-1');
    expect(acctTallies.length).toBeGreaterThan(0);
  });

  // --- Nonce reuse triggers fraud tracking ---

  it.skipIf(!available)('nonce reuse increments nonce-failure fraud tally', async () => {
    mockVerifyPayment.mockResolvedValueOnce({ ok: true, blockNumber: 20 });

    const nonce = 'nonce_fraud_track1';
    await enforceX402(makeInput(validHeader({ nonce })));

    // Reuse the nonce — should trigger trackNonceFailure
    try {
      await enforceX402(makeInput(validHeader({ nonce })));
    } catch {
      /* expected 402 */
    }

    // Check fraud-tally for nonce-fail window key
    const scan = await ddbClient.send(new ScanCommand({ TableName: 'x402-fraud-tally' }));
    const tallies = (scan.Items ?? []).filter((i) => i.windowKey?.S?.startsWith('nonce-fail:'));
    expect(tallies.length).toBeGreaterThan(0);
  });

  // --- Verification params correctness ---

  it.skipIf(!available)('passes correct params to chain verifyPayment', async () => {
    mockVerifyPayment.mockResolvedValueOnce({ ok: true, blockNumber: 7 });

    const nonce = 'verify_params_nce1';
    const route = makeRoute({ amountWei: '9999999' });
    const input = {
      headers: { 'x-payment': validHeader({ nonce }) },
      route,
      accountId: 'acct-verify-params',
    };
    await enforceX402(input);

    expect(mockVerifyPayment).toHaveBeenCalledWith({
      txHash: MOCK_TX_HASH,
      expectedTo: MOCK_ADDRESS,
      expectedAmountWei: BigInt('9999999'),
      minConfirmations: 2,
    });
  });

  // --- Different accounts are isolated ---

  it.skipIf(!available)('isolates payment records by account', async () => {
    mockVerifyPayment.mockResolvedValue({ ok: true, blockNumber: 30 });

    await enforceX402(makeInput(validHeader({ nonce: 'acct_iso_nonce_a1' }), 'acct-A'));
    await enforceX402(makeInput(validHeader({ nonce: 'acct_iso_nonce_b1' }), 'acct-B'));

    const yearMonth = new Date().toISOString().slice(0, 7);

    const usageA = await docClient.send(
      new GetCommand({ TableName: 'x402-usage', Key: { accountId: 'acct-A', yearMonth } }),
    );
    const usageB = await docClient.send(
      new GetCommand({ TableName: 'x402-usage', Key: { accountId: 'acct-B', yearMonth } }),
    );
    expect(usageA.Item.callCount).toBe(1);
    expect(usageB.Item.callCount).toBe(1);
  });

  // --- Amount bounds fraud rejection ---

  it.skipIf(!available)('rejects payment below fraud minimum amount', async () => {
    const route = makeRoute({ amountWei: '1' }); // below default min of 1000
    const input = {
      headers: { 'x-payment': validHeader({ nonce: 'low_amount_nonce1' }) },
      route,
      accountId: 'acct-low-amt',
    };

    try {
      await enforceX402(input);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e.constructor.name).toBe('FraudDetectedError');
    }

    // No payment recorded
    const payment = await docClient.send(
      new GetCommand({ TableName: 'x402-payments', Key: { idempotencyKey: 'low_amount_nonce1' } }),
    );
    expect(payment.Item).toBeUndefined();
  });

  // --- Uppercase X-PAYMENT header ---

  it.skipIf(!available)('accepts uppercase X-PAYMENT header', async () => {
    mockVerifyPayment.mockResolvedValueOnce({ ok: true, blockNumber: 60 });

    const nonce = 'uppercase_header1';
    const input = {
      headers: { 'X-PAYMENT': validHeader({ nonce }) },
      route: makeRoute(),
      accountId: 'acct-upper',
    };
    const result = await enforceX402(input);
    expect(result.paid).toBe(true);
  });
});

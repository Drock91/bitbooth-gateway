import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  DeleteCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import { isLocalStackUp, createTable, destroyTable, ddbClient } from './helpers.js';

const MOCK_ADDRESS = '0xFetchAgent000000000000000000000000000000';
const MOCK_TX_HASH = '0x' + 'cf'.repeat(32);
const MOCK_NONCE = 'fetch_integ_nonce_pad_';

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

const mockXrplVerify = vi.fn();
const mockGetAgentAddress = vi.fn(() => Promise.resolve(MOCK_ADDRESS));

vi.mock('../../src/adapters/xrpl-evm/index.js', () => ({
  verifyPayment: mockXrplVerify,
  getAgentAddress: mockGetAgentAddress,
}));

const mockBaseVerify = vi.fn();
vi.mock('../../src/adapters/base/index.js', () => ({
  verifyPayment: mockBaseVerify,
  BASE_CHAIN_ID: 8453,
}));

const mockNativeXrplVerify = vi.fn();
vi.mock('../../src/adapters/xrpl/index.js', () => ({
  verifyPayment: mockNativeXrplVerify,
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
    const tableDefs = {
      'x402-payments': ['idempotencyKey'],
      'x402-usage': ['accountId', 'yearMonth'],
      'x402-fraud-tally': ['accountId', 'windowKey'],
      'x402-fraud-events': ['accountId', 'timestamp'],
    };
    const keyAttrs = tableDefs[tableName] ?? [];
    const keyOnly = {};
    for (const attr of keyAttrs) keyOnly[attr] = key[attr];
    await docClient.send(new DeleteCommand({ TableName: tableName, Key: keyOnly }));
  }
}

function fetchRoute(overrides = {}) {
  return {
    amountWei: '5000',
    assetSymbol: 'USDC',
    resource: '/v1/fetch',
    fraudRules: {},
    ...overrides,
  };
}

function paymentHeader(overrides = {}) {
  return JSON.stringify({
    nonce: 'fetch_pay_nonce_aa1',
    txHash: MOCK_TX_HASH,
    signature: 'sig_fetch',
    ...overrides,
  });
}

function makeInput(headerValue, accountId = 'acct-fetch-1', routeOverrides = {}) {
  return {
    headers: headerValue != null ? { 'x-payment': headerValue } : {},
    route: fetchRoute(routeOverrides),
    accountId,
  };
}

beforeAll(async () => {
  available = await isLocalStackUp();
  if (!available) return;
  for (const t of TABLES) await createTable(t);
  const mod = await import('../../src/middleware/x402.middleware.js');
  enforceX402 = mod.enforceX402;
});

afterAll(async () => {
  if (!available) return;
  for (const t of TABLES) await destroyTable(t);
});

describe('/v1/fetch x402 payment flow integration', () => {
  beforeEach(async () => {
    if (!available) return;
    vi.clearAllMocks();
    mockGetAgentAddress.mockResolvedValue(MOCK_ADDRESS);
    nonceCounter = 0;
    for (const t of TABLES) await clearTable(`x402-${t}`);
  });

  // --- Challenge issuance with multi-chain accepts ---

  it.skipIf(!available)(
    'returns 402 challenge with multi-chain accepts for /v1/fetch',
    async () => {
      const input = makeInput(null);
      try {
        await enforceX402(input);
        expect.unreachable('should throw PaymentRequiredError');
      } catch (e) {
        expect(e.constructor.name).toBe('PaymentRequiredError');
        const c = e.challenge;
        expect(c.resource).toBe('/v1/fetch');
        expect(c.amountWei).toBe('5000');
        expect(c.assetSymbol).toBe('USDC');
        expect(c.payTo).toBe(MOCK_ADDRESS);
        expect(c.nonce).toBeTruthy();
        expect(c.expiresAt).toBeTypeOf('number');
        expect(c.chainId).toBe(8453);

        expect(c.accepts).toBeInstanceOf(Array);
        expect(c.accepts.length).toBeGreaterThanOrEqual(1);
        const baseAccept = c.accepts.find((a) => a.network === 'eip155:8453');
        expect(baseAccept).toBeTruthy();
        expect(baseAccept.scheme).toBe('exact');
        expect(baseAccept.payTo).toBe(MOCK_ADDRESS);
        expect(baseAccept.amount).toBe('5000');
        expect(baseAccept.asset).toContain('USDC@');
      }
    },
  );

  // --- Happy path: pay via Base, verify, persist ---

  it.skipIf(!available)(
    'verifies Base payment, persists to DDB, increments usage for /v1/fetch',
    async () => {
      mockBaseVerify.mockResolvedValueOnce({ ok: true, blockNumber: 777 });

      const nonce = 'fetch_happy_nonce1';
      const input = makeInput(paymentHeader({ nonce, network: 'eip155:8453' }));
      const result = await enforceX402(input);

      expect(result).toEqual({ paid: true, txHash: MOCK_TX_HASH });

      const payment = await docClient.send(
        new GetCommand({ TableName: 'x402-payments', Key: { idempotencyKey: nonce } }),
      );
      expect(payment.Item).toBeTruthy();
      expect(payment.Item.accountId).toBe('acct-fetch-1');
      expect(payment.Item.txHash).toBe(MOCK_TX_HASH);
      expect(payment.Item.blockNumber).toBe(777);
      expect(payment.Item.status).toBe('confirmed');
      expect(payment.Item.amountWei).toBe('5000');

      const yearMonth = new Date().toISOString().slice(0, 7);
      const usage = await docClient.send(
        new GetCommand({
          TableName: 'x402-usage',
          Key: { accountId: 'acct-fetch-1', yearMonth },
        }),
      );
      expect(usage.Item).toBeTruthy();
      expect(usage.Item.callCount).toBe(1);
    },
  );

  // --- Base adapter receives correct params ---

  it.skipIf(!available)('passes correct params to Base verifyPayment', async () => {
    mockBaseVerify.mockResolvedValueOnce({ ok: true, blockNumber: 88 });

    const nonce = 'fetch_params_nce1';
    const input = makeInput(paymentHeader({ nonce, network: 'eip155:8453' }), 'acct-params', {
      amountWei: '9999',
    });
    await enforceX402(input);

    expect(mockBaseVerify).toHaveBeenCalledWith({
      txHash: MOCK_TX_HASH,
      expectedTo: MOCK_ADDRESS,
      expectedAmountWei: BigInt('9999'),
      minConfirmations: 2,
    });
    expect(mockXrplVerify).not.toHaveBeenCalled();
  });

  // --- Default network resolves to Base (CHAIN_ID=8453) ---

  it.skipIf(!available)('routes to Base adapter when no explicit network', async () => {
    mockBaseVerify.mockResolvedValueOnce({ ok: true, blockNumber: 50 });

    const nonce = 'fetch_default_net1';
    const input = makeInput(paymentHeader({ nonce }));
    await enforceX402(input);

    expect(mockBaseVerify).toHaveBeenCalled();
    expect(mockXrplVerify).not.toHaveBeenCalled();
  });

  // --- Explicit xrpl-evm network routes correctly ---

  it.skipIf(!available)('routes to xrpl-evm adapter for eip155:1440002', async () => {
    mockXrplVerify.mockResolvedValueOnce({ ok: true, blockNumber: 33 });

    const nonce = 'fetch_xrpl_nonce1';
    const input = makeInput(paymentHeader({ nonce, network: 'eip155:1440002' }));
    await enforceX402(input);

    expect(mockXrplVerify).toHaveBeenCalled();
    expect(mockBaseVerify).not.toHaveBeenCalled();
  });

  // --- Native XRPL routing ---

  it.skipIf(!available)('routes to native XRPL adapter for xrpl:1 (testnet)', async () => {
    mockNativeXrplVerify.mockResolvedValueOnce({ ok: true, ledgerIndex: 44 });

    const nonce = 'fetch_xrpl_nat_1';
    const input = makeInput(paymentHeader({ nonce, network: 'xrpl:1' }));
    const result = await enforceX402(input);

    expect(result).toEqual({ paid: true, txHash: MOCK_TX_HASH });
    expect(mockNativeXrplVerify).toHaveBeenCalled();
    expect(mockBaseVerify).not.toHaveBeenCalled();
    expect(mockXrplVerify).not.toHaveBeenCalled();
  });

  it.skipIf(!available)('routes to native XRPL adapter for xrpl:0 (mainnet)', async () => {
    mockNativeXrplVerify.mockResolvedValueOnce({ ok: true, ledgerIndex: 100 });

    const nonce = 'fetch_xrpl_mn_1';
    const input = makeInput(paymentHeader({ nonce, network: 'xrpl:0' }));
    const result = await enforceX402(input);

    expect(result).toEqual({ paid: true, txHash: MOCK_TX_HASH });
    expect(mockNativeXrplVerify).toHaveBeenCalled();
    expect(mockBaseVerify).not.toHaveBeenCalled();
  });

  it.skipIf(!available)('native XRPL strips 0x prefix from txHash', async () => {
    mockNativeXrplVerify.mockResolvedValueOnce({ ok: true, ledgerIndex: 55 });

    const nonce = 'fetch_xrpl_pfx1';
    const input = makeInput(paymentHeader({ nonce, network: 'xrpl:1' }));
    await enforceX402(input);

    const call = mockNativeXrplVerify.mock.calls[0][0];
    expect(call.txHash).not.toMatch(/^0x/);
    expect(call.destination).toBe(MOCK_ADDRESS);
  });

  it.skipIf(!available)('native XRPL verification failure returns 402 with reason', async () => {
    mockNativeXrplVerify.mockResolvedValueOnce({ ok: false, reason: 'destination-mismatch' });

    const nonce = 'fetch_xrpl_fail';
    const input = makeInput(paymentHeader({ nonce, network: 'xrpl:1' }));
    try {
      await enforceX402(input);
      expect.unreachable('should throw');
    } catch (e) {
      expect(e.constructor.name).toBe('PaymentRequiredError');
      expect(e.challenge.reason).toBe('destination-mismatch');
    }
  });

  it.skipIf(!available)('persists payment to DDB after native XRPL verification', async () => {
    mockNativeXrplVerify.mockResolvedValueOnce({ ok: true, ledgerIndex: 77 });

    const nonce = 'fetch_xrpl_ddb1';
    const input = makeInput(paymentHeader({ nonce, network: 'xrpl:0' }));
    await enforceX402(input);

    const payment = await docClient.send(
      new GetCommand({ TableName: 'x402-payments', Key: { idempotencyKey: nonce } }),
    );
    expect(payment.Item).toBeTruthy();
    expect(payment.Item.accountId).toBe('acct-fetch-1');
    expect(payment.Item.txHash).toBe(MOCK_TX_HASH);
    expect(payment.Item.status).toBe('confirmed');
  });

  // --- Unsupported network rejected ---

  it.skipIf(!available)('rejects unsupported network with fresh challenge', async () => {
    const nonce = 'fetch_unsup_nonce';
    const input = makeInput(paymentHeader({ nonce, network: 'solana:fake' }));
    try {
      await enforceX402(input);
      expect.unreachable('should throw');
    } catch (e) {
      expect(e.constructor.name).toBe('PaymentRequiredError');
      expect(e.challenge.reason).toBe('unsupported-network');
    }
  });

  // --- Nonce reuse on fetch route ---

  it.skipIf(!available)('rejects nonce reuse on /v1/fetch route', async () => {
    mockBaseVerify.mockResolvedValueOnce({ ok: true, blockNumber: 11 });

    const nonce = 'fetch_reuse_nce_1';
    await enforceX402(makeInput(paymentHeader({ nonce, network: 'eip155:8453' })));

    try {
      await enforceX402(makeInput(paymentHeader({ nonce, network: 'eip155:8453' })));
      expect.unreachable('should throw');
    } catch (e) {
      expect(e.constructor.name).toBe('PaymentRequiredError');
      expect(e.challenge.nonce).toBeTruthy();
    }

    const yearMonth = new Date().toISOString().slice(0, 7);
    const usage = await docClient.send(
      new GetCommand({
        TableName: 'x402-usage',
        Key: { accountId: 'acct-fetch-1', yearMonth },
      }),
    );
    expect(usage.Item.callCount).toBe(1);
  });

  // --- Base verification failure ---

  it.skipIf(!available)('rejects when Base verifyPayment returns ok:false', async () => {
    mockBaseVerify.mockResolvedValueOnce({ ok: false, reason: 'amount-too-low' });

    const nonce = 'fetch_fail_ver_1';
    const input = makeInput(paymentHeader({ nonce, network: 'eip155:8453' }));
    try {
      await enforceX402(input);
      expect.unreachable('should throw');
    } catch (e) {
      expect(e.constructor.name).toBe('PaymentRequiredError');
      expect(e.challenge.reason).toBe('amount-too-low');
    }

    const payment = await docClient.send(
      new GetCommand({ TableName: 'x402-payments', Key: { idempotencyKey: nonce } }),
    );
    expect(payment.Item).toBeUndefined();
  });

  // --- Sequential fetch payments ---

  it.skipIf(!available)('handles sequential fetch payments with different nonces', async () => {
    mockBaseVerify.mockResolvedValue({ ok: true, blockNumber: 200 });

    const nonces = ['fetch_seq_nonce_1', 'fetch_seq_nonce_2', 'fetch_seq_nonce_3'];
    for (const nonce of nonces) {
      const result = await enforceX402(makeInput(paymentHeader({ nonce, network: 'eip155:8453' })));
      expect(result.paid).toBe(true);
    }

    for (const nonce of nonces) {
      const payment = await docClient.send(
        new GetCommand({ TableName: 'x402-payments', Key: { idempotencyKey: nonce } }),
      );
      expect(payment.Item).toBeTruthy();
      expect(payment.Item.status).toBe('confirmed');
    }

    const yearMonth = new Date().toISOString().slice(0, 7);
    const usage = await docClient.send(
      new GetCommand({
        TableName: 'x402-usage',
        Key: { accountId: 'acct-fetch-1', yearMonth },
      }),
    );
    expect(usage.Item.callCount).toBe(3);
  });

  // --- Cross-account isolation ---

  it.skipIf(!available)('isolates fetch payments by account', async () => {
    mockBaseVerify.mockResolvedValue({ ok: true, blockNumber: 300 });

    await enforceX402(
      makeInput(paymentHeader({ nonce: 'fetch_iso_acct_a', network: 'eip155:8453' }), 'acct-A'),
    );
    await enforceX402(
      makeInput(paymentHeader({ nonce: 'fetch_iso_acct_b', network: 'eip155:8453' }), 'acct-B'),
    );

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

  // --- Malformed header ---

  it.skipIf(!available)('rejects malformed X-PAYMENT JSON', async () => {
    try {
      await enforceX402(makeInput('not-valid-json'));
      expect.unreachable('should throw');
    } catch (e) {
      expect(e.constructor.name).toBe('ValidationError');
    }
  });

  // --- Fraud detection for fetch route ---

  it.skipIf(!available)('records fraud tally for fetch payment', async () => {
    mockBaseVerify.mockResolvedValueOnce({ ok: true, blockNumber: 55 });

    await enforceX402(
      makeInput(paymentHeader({ nonce: 'fetch_fraud_nce1', network: 'eip155:8453' })),
    );

    const scan = await ddbClient.send(new ScanCommand({ TableName: 'x402-fraud-tally' }));
    const tallies = (scan.Items ?? []).filter((i) => i.accountId?.S === 'acct-fetch-1');
    expect(tallies.length).toBeGreaterThan(0);
  });

  // --- Nonce reuse triggers fraud tracking ---

  it.skipIf(!available)('nonce reuse on fetch increments nonce-failure tally', async () => {
    mockBaseVerify.mockResolvedValueOnce({ ok: true, blockNumber: 20 });

    const nonce = 'fetch_nonce_fraud';
    await enforceX402(makeInput(paymentHeader({ nonce, network: 'eip155:8453' })));

    try {
      await enforceX402(makeInput(paymentHeader({ nonce, network: 'eip155:8453' })));
    } catch {
      /* expected 402 */
    }

    const scan = await ddbClient.send(new ScanCommand({ TableName: 'x402-fraud-tally' }));
    const nonceFails = (scan.Items ?? []).filter((i) => i.windowKey?.S?.startsWith('nonce-fail:'));
    expect(nonceFails.length).toBeGreaterThan(0);
  });
});

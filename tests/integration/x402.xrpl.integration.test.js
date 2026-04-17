import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  DeleteCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import { isLocalStackUp, createTable, destroyTable, ddbClient } from './helpers.js';

// --- Fixed XRPL addresses (valid base58 r-addresses) ---
const USDC_ISSUER = 'rcEGREd8NmkKRE8GE424sksyt1tJVFZwu';
const RLUSD_ISSUER = 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De';
const FORGED_ISSUER = 'rPVMhWBsfF9iMXYj3aAzJVkqHDhV3LGZWB';
const XRPL_DEST = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';
const XRPL_SENDER = 'rN7n3473SaZBCG4dFL83w7p1W6G3nUqUKr';
const MOCK_TX_HASH = 'A'.repeat(64);
const BASE_NONCE = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';

// XRPL config must be set before getConfig() is first called.
process.env.XRPL_PAY_TO = XRPL_DEST;
process.env.XRPL_USDC_ISSUER = USDC_ISSUER;
process.env.XRPL_RLUSD_ISSUER = RLUSD_ISSUER;

// --- xrpl.js Client mock (native XRPL adapter's only external dep) ---
const mockConnect = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockRequest = vi.hoisted(() => vi.fn());
const mockDisconnect = vi.hoisted(() => vi.fn());
const mockIsConnected = vi.hoisted(() => vi.fn(() => false));
const MockClient = vi.hoisted(() =>
  vi.fn(function () {
    this.connect = mockConnect;
    this.request = mockRequest;
    this.disconnect = mockDisconnect;
    this.isConnected = mockIsConnected;
  }),
);
vi.mock('xrpl', () => ({ Client: MockClient }));

// The current middleware uses getAgentAddress() (EVM) as `expectedTo` for every chain;
// native XRPL verification compares it against the tx Destination. Return the XRPL
// destination here so wrapXrplVerify routes a valid tx through — this keeps the test
// focused on cross-asset routing (G-232) rather than G-244 cross-chain payTo resolution.
const mockGetAgentAddress = vi.fn(() => Promise.resolve(XRPL_DEST));
vi.mock('../../src/adapters/xrpl-evm/index.js', () => ({
  verifyPayment: vi.fn(),
  getAgentAddress: mockGetAgentAddress,
}));

let nonceCounter = 0;
vi.mock('../../src/lib/crypto.js', () => ({
  newNonce: () => `${BASE_NONCE}${String(nonceCounter++).padStart(4, '0')}`,
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

vi.mock('../../src/lib/metrics.js', () => ({
  paymentVerified: vi.fn(),
  paymentFailed: vi.fn(),
  emitMetric: vi.fn(),
}));

let available = false;
let enforceX402;
const docClient = DynamoDBDocumentClient.from(ddbClient);
const TABLES = ['payments', 'usage', 'fraud-tally', 'fraud-events'];
const KEY_ATTRS = {
  'x402-payments': ['idempotencyKey'],
  'x402-usage': ['accountId', 'yearMonth'],
  'x402-fraud-tally': ['accountId', 'windowKey'],
  'x402-fraud-events': ['accountId', 'timestamp'],
};

async function clearTable(tableName) {
  const res = await ddbClient.send(new ScanCommand({ TableName: tableName }));
  if (!res.Items?.length) return;
  for (const item of res.Items) {
    const raw = {};
    for (const [k, v] of Object.entries(item)) {
      if (v.S !== undefined) raw[k] = v.S;
      else if (v.N !== undefined) raw[k] = Number(v.N);
    }
    const keyOnly = {};
    for (const attr of KEY_ATTRS[tableName] ?? []) keyOnly[attr] = raw[attr];
    await docClient.send(new DeleteCommand({ TableName: tableName, Key: keyOnly }));
  }
}

function makeIouTx({
  currency = 'USD',
  issuer = USDC_ISSUER,
  value = '5',
  destination = XRPL_DEST,
  result = 'tesSUCCESS',
  validated = true,
  ledger = 83145921,
} = {}) {
  const iou = { currency, issuer, value };
  return {
    TransactionType: 'Payment',
    Account: XRPL_SENDER,
    Destination: destination,
    Amount: iou,
    validated,
    meta: { TransactionResult: result, delivered_amount: iou },
    ledger_index: ledger,
  };
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

function payHeader(overrides = {}) {
  return JSON.stringify({
    nonce: 'xrpl_nonce_fixed01',
    txHash: MOCK_TX_HASH,
    signature: 'sig',
    network: 'xrpl:0',
    ...overrides,
  });
}

function makeInput(headerValue, accountId = 'acct-xrpl-1') {
  return {
    headers: headerValue != null ? { 'x-payment': headerValue } : {},
    route: makeRoute(),
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

describe('x402 native XRPL flow integration', () => {
  beforeEach(async () => {
    if (!available) return;
    vi.clearAllMocks();
    mockIsConnected.mockReturnValue(false);
    mockConnect.mockResolvedValue(undefined);
    mockGetAgentAddress.mockResolvedValue(XRPL_DEST);
    nonceCounter = 0;
    for (const t of TABLES) await clearTable(`x402-${t}`);
  });

  // --- Challenge includes xrpl accepts[] for XRP + USDC + RLUSD ---

  it.skipIf(!available)('challenge advertises XRP, USDC, and RLUSD on xrpl:1', async () => {
    try {
      await enforceX402(makeInput(null));
      expect.unreachable('should throw PaymentRequiredError');
    } catch (e) {
      expect(e.constructor.name).toBe('PaymentRequiredError');
      const accepts = e.challenge.accepts;
      const xrplEntries = accepts.filter((a) => a.network === 'xrpl:1');
      expect(xrplEntries).toHaveLength(3);
      const assets = xrplEntries.map((a) => a.asset).sort();
      expect(assets).toEqual([`RLUSD@${RLUSD_ISSUER}`, `USDC@${USDC_ISSUER}`, 'XRP'].sort());
      for (const entry of xrplEntries) {
        expect(entry.payTo).toBe(XRPL_DEST);
        expect(entry.amount).toBe('5000000');
        expect(entry.scheme).toBe('exact');
      }
    }
  });

  // --- 200: USDC IOU payment routes to wrapXrplVerify → ok, persists ---

  it.skipIf(!available)('accepts USDC IOU payment and persists to DDB', async () => {
    mockRequest.mockResolvedValue({
      result: makeIouTx({ currency: 'USD', issuer: USDC_ISSUER, value: '5' }),
    });

    const nonce = 'xrpl_usdc_ok_nonce1';
    const result = await enforceX402(makeInput(payHeader({ nonce })));

    expect(result).toEqual({ paid: true, txHash: MOCK_TX_HASH });
    expect(mockRequest).toHaveBeenCalledWith({ command: 'tx', transaction: MOCK_TX_HASH });

    const payment = await docClient.send(
      new GetCommand({ TableName: 'x402-payments', Key: { idempotencyKey: nonce } }),
    );
    expect(payment.Item).toBeTruthy();
    expect(payment.Item.status).toBe('confirmed');
    expect(payment.Item.txHash).toBe(MOCK_TX_HASH);
    expect(payment.Item.accountId).toBe('acct-xrpl-1');
  });

  // --- 200: RLUSD IOU payment routes through same wrapXrplVerify → ok ---

  it.skipIf(!available)('accepts RLUSD IOU payment via multi-issuer allowed list', async () => {
    mockRequest.mockResolvedValue({
      result: makeIouTx({ currency: 'RLUSD', issuer: RLUSD_ISSUER, value: '5' }),
    });

    const nonce = 'xrpl_rlusd_ok_nonce';
    const result = await enforceX402(makeInput(payHeader({ nonce }), 'acct-xrpl-rlusd'));

    expect(result.paid).toBe(true);
    const payment = await docClient.send(
      new GetCommand({ TableName: 'x402-payments', Key: { idempotencyKey: nonce } }),
    );
    expect(payment.Item.accountId).toBe('acct-xrpl-rlusd');
  });

  // --- 403: forged issuer rejected (neither USDC nor RLUSD issuer matches) ---

  it.skipIf(!available)('rejects IOU delivered from a forged issuer', async () => {
    mockRequest.mockResolvedValue({
      result: makeIouTx({ currency: 'USD', issuer: FORGED_ISSUER, value: '5' }),
    });

    const nonce = 'xrpl_forged_nonce01';
    try {
      await enforceX402(makeInput(payHeader({ nonce }), 'acct-xrpl-forged'));
      expect.unreachable('should throw PaymentRequiredError');
    } catch (e) {
      expect(e.constructor.name).toBe('PaymentRequiredError');
      expect(e.challenge.reason).toBe('amount-mismatch');
    }

    const payment = await docClient.send(
      new GetCommand({ TableName: 'x402-payments', Key: { idempotencyKey: nonce } }),
    );
    expect(payment.Item).toBeUndefined();
  });

  // --- 403: RLUSD currency with Circle USDC issuer (common spoofing pattern) ---

  it.skipIf(!available)('rejects RLUSD currency forged with USDC issuer', async () => {
    mockRequest.mockResolvedValue({
      result: makeIouTx({ currency: 'RLUSD', issuer: USDC_ISSUER, value: '5' }),
    });

    const nonce = 'xrpl_xspoof_nonce01';
    try {
      await enforceX402(makeInput(payHeader({ nonce }), 'acct-xrpl-xspoof'));
      expect.unreachable('should throw PaymentRequiredError');
    } catch (e) {
      expect(e.challenge.reason).toBe('amount-mismatch');
    }
  });

  // --- xrpl:1 testnet routes through same wrapXrplVerify ---

  it.skipIf(!available)('accepts IOU on xrpl:1 testnet', async () => {
    mockRequest.mockResolvedValue({
      result: makeIouTx({ currency: 'USD', issuer: USDC_ISSUER, value: '5' }),
    });

    const nonce = 'xrpl_testnet_nonce1';
    const result = await enforceX402(
      makeInput(payHeader({ nonce, network: 'xrpl:1' }), 'acct-xrpl-testnet'),
    );
    expect(result.paid).toBe(true);
  });

  // --- Rejection: tx destination != expected payTo ---

  it.skipIf(!available)('rejects IOU delivered to wrong destination', async () => {
    mockRequest.mockResolvedValue({
      result: makeIouTx({
        currency: 'USD',
        issuer: USDC_ISSUER,
        value: '5',
        destination: 'rPVMhWBsfF9iMXYj3aAzJVkqHDhV3LGZWB',
      }),
    });

    try {
      await enforceX402(makeInput(payHeader({ nonce: 'xrpl_wrongdest_nonc' }), 'acct-xrpl-wd'));
      expect.unreachable('should throw PaymentRequiredError');
    } catch (e) {
      expect(e.challenge.reason).toBe('wrong-destination');
    }
  });

  // --- Rejection: tx not validated yet on the ledger ---

  it.skipIf(!available)('rejects unvalidated IOU', async () => {
    mockRequest.mockResolvedValue({
      result: makeIouTx({ currency: 'USD', issuer: USDC_ISSUER, value: '5', validated: false }),
    });

    try {
      await enforceX402(makeInput(payHeader({ nonce: 'xrpl_novalid_nonce1' }), 'acct-xrpl-nv'));
      expect.unreachable('should throw PaymentRequiredError');
    } catch (e) {
      expect(e.challenge.reason).toBe('not-validated');
    }
  });

  // --- Rejection: tx settled with non-tesSUCCESS result ---

  it.skipIf(!available)('rejects IOU with failed TransactionResult', async () => {
    mockRequest.mockResolvedValue({
      result: makeIouTx({
        currency: 'USD',
        issuer: USDC_ISSUER,
        value: '5',
        result: 'tecPATH_PARTIAL',
      }),
    });

    try {
      await enforceX402(makeInput(payHeader({ nonce: 'xrpl_txfail_nonce01' }), 'acct-xrpl-fail'));
      expect.unreachable('should throw PaymentRequiredError');
    } catch (e) {
      expect(e.challenge.reason).toBe('tx-failed');
    }
  });

  // --- Rejection: IOU underpayment below route amount ---

  it.skipIf(!available)('rejects IOU delivered below route amount', async () => {
    mockRequest.mockResolvedValue({
      result: makeIouTx({ currency: 'USD', issuer: USDC_ISSUER, value: '0.001' }),
    });

    try {
      await enforceX402(makeInput(payHeader({ nonce: 'xrpl_underpay_nonce' }), 'acct-xrpl-under'));
      expect.unreachable('should throw PaymentRequiredError');
    } catch (e) {
      expect(e.challenge.reason).toBe('amount-mismatch');
    }
  });

  // --- Nonce reuse on XRPL flow produces a fresh 402 ---

  it.skipIf(!available)('rejects nonce reuse on xrpl after a successful payment', async () => {
    mockRequest.mockResolvedValue({
      result: makeIouTx({ currency: 'USD', issuer: USDC_ISSUER, value: '5' }),
    });

    const nonce = 'xrpl_reuse_nonce001';
    await enforceX402(makeInput(payHeader({ nonce }), 'acct-xrpl-reuse'));

    try {
      await enforceX402(makeInput(payHeader({ nonce }), 'acct-xrpl-reuse'));
      expect.unreachable('should throw PaymentRequiredError');
    } catch (e) {
      expect(e.constructor.name).toBe('PaymentRequiredError');
      expect(e.challenge.nonce).toBeTruthy();
    }

    const yearMonth = new Date().toISOString().slice(0, 7);
    const usage = await docClient.send(
      new GetCommand({
        TableName: 'x402-usage',
        Key: { accountId: 'acct-xrpl-reuse', yearMonth },
      }),
    );
    expect(usage.Item.callCount).toBe(1);
  });
});

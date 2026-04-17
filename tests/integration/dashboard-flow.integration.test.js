import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { DynamoDBDocumentClient, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { isLocalStackUp, createTable, destroyTable, ddbClient } from './helpers.js';

const MOCK_ADDRESS = '0xAgentWallet00000000000000000000000000ab';
const MOCK_TX_HASH = '0x' + 'cd'.repeat(32);

let nonceCounter = 0;
vi.mock('../../src/lib/crypto.js', () => ({
  newNonce: () => `dashflow_nonce_${String(nonceCounter++).padStart(6, '0')}`,
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
  tenantSignup: vi.fn(),
  emitMetric: vi.fn(),
}));

let available = false;
const docClient = DynamoDBDocumentClient.from(ddbClient);

const ALL_TABLES = [
  'tenants',
  'routes',
  'payments',
  'usage',
  'fraud-tally',
  'fraud-events',
  'rate-limits',
  'idempotency',
];

async function clearTable(tableName) {
  const { ScanCommand: RawScan } = await import('@aws-sdk/client-dynamodb');
  const res = await ddbClient.send(new RawScan({ TableName: tableName }));
  if (!res.Items?.length) return;
  for (const item of res.Items) {
    const key = {};
    for (const [k, v] of Object.entries(item)) {
      if (v.S !== undefined) key[k] = v.S;
      else if (v.N !== undefined) key[k] = Number(v.N);
    }
    const keySchemas = {
      'x402-tenants': ['accountId'],
      'x402-routes': ['tenantId', 'path'],
      'x402-payments': ['idempotencyKey'],
      'x402-usage': ['accountId', 'yearMonth'],
      'x402-fraud-tally': ['accountId', 'windowKey'],
      'x402-fraud-events': ['accountId', 'timestamp'],
      'x402-rate-limits': ['accountId'],
      'x402-idempotency': ['idempotencyKey'],
    };
    const keyAttrs = keySchemas[tableName] ?? [];
    const keyOnly = {};
    for (const attr of keyAttrs) keyOnly[attr] = key[attr];
    await docClient.send(new DeleteCommand({ TableName: tableName, Key: keyOnly }));
  }
}

let dashboardService, authenticate, routesService, enforceX402, paymentsService;

beforeAll(async () => {
  available = await isLocalStackUp();
  if (!available) return;

  for (const t of ALL_TABLES) await createTable(t);

  const dashMod = await import('../../src/services/dashboard.service.js');
  dashboardService = dashMod.dashboardService;

  const authMod = await import('../../src/middleware/auth.middleware.js');
  authenticate = authMod.authenticate;

  const routesMod = await import('../../src/services/routes.service.js');
  routesService = routesMod.routesService;

  const x402Mod = await import('../../src/middleware/x402.middleware.js');
  enforceX402 = x402Mod.enforceX402;

  const payMod = await import('../../src/services/payments.service.js');
  paymentsService = payMod.paymentsService;
});

afterAll(async () => {
  if (!available) return;
  for (const t of ALL_TABLES) await destroyTable(t);
});

describe('dashboard signup → route → payment integration', () => {
  beforeEach(async () => {
    if (!available) return;
    vi.clearAllMocks();
    mockGetAgentAddress.mockResolvedValue(MOCK_ADDRESS);
    nonceCounter = 0;
    for (const t of ALL_TABLES) {
      await clearTable(`x402-${t}`);
    }
  });

  // --- Signup creates tenant retrievable by API key ---

  it.skipIf(!available)('signup creates tenant that can authenticate', async () => {
    const { accountId, apiKey } = await dashboardService.signup();

    expect(accountId).toBeTruthy();
    expect(apiKey).toMatch(/^x402_/);

    const auth = await authenticate({ 'x-api-key': apiKey });
    expect(auth.accountId).toBe(accountId);
    expect(auth.plan).toBe('free');
  });

  // --- Full flow: signup → create route → make payment ---

  it.skipIf(!available)(
    'full flow: signup, create route, pay, verify payment recorded',
    async () => {
      // Step 1: Signup
      const { accountId } = await dashboardService.signup();

      // Step 2: Create a route
      const routeInput = { path: '/v1/premium', priceWei: '1000000', asset: 'USDC' };
      await dashboardService.upsertRoute(accountId, routeInput);

      // Verify route is retrievable
      const routeConfig = await routesService.getRouteConfig(accountId, '/v1/premium');
      expect(routeConfig.amountWei).toBe('1000000');
      expect(routeConfig.assetSymbol).toBe('USDC');
      expect(routeConfig.resource).toBe('/v1/premium');

      // Step 3: Make a payment through x402
      mockVerifyPayment.mockResolvedValueOnce({ ok: true, blockNumber: 77 });

      const nonce = 'fullflow_nonce_01';
      const paymentHeader = JSON.stringify({
        nonce,
        txHash: MOCK_TX_HASH,
        signature: 'sig_full_flow',
      });

      const result = await enforceX402({
        headers: { 'x-payment': paymentHeader },
        route: routeConfig,
        accountId,
      });

      expect(result).toEqual({ paid: true, txHash: MOCK_TX_HASH });

      // Step 4: Verify payment was recorded
      const payment = await docClient.send(
        new GetCommand({ TableName: 'x402-payments', Key: { idempotencyKey: nonce } }),
      );
      expect(payment.Item).toBeTruthy();
      expect(payment.Item.accountId).toBe(accountId);
      expect(payment.Item.status).toBe('confirmed');
      expect(payment.Item.txHash).toBe(MOCK_TX_HASH);
      expect(payment.Item.blockNumber).toBe(77);

      // Step 5: Verify usage incremented
      const yearMonth = new Date().toISOString().slice(0, 7);
      const usage = await docClient.send(
        new GetCommand({ TableName: 'x402-usage', Key: { accountId, yearMonth } }),
      );
      expect(usage.Item).toBeTruthy();
      expect(usage.Item.callCount).toBe(1);
    },
  );

  // --- Payment history after payment ---

  it.skipIf(!available)('payment appears in listPayments after successful x402 flow', async () => {
    const { accountId } = await dashboardService.signup();
    await dashboardService.upsertRoute(accountId, {
      path: '/v1/data',
      priceWei: '500000',
      asset: 'USDC',
    });

    mockVerifyPayment.mockResolvedValueOnce({ ok: true, blockNumber: 10 });

    const routeConfig = await routesService.getRouteConfig(accountId, '/v1/data');
    await enforceX402({
      headers: {
        'x-payment': JSON.stringify({
          nonce: 'history_nonce_001',
          txHash: MOCK_TX_HASH,
          signature: 'sig1',
        }),
      },
      route: routeConfig,
      accountId,
    });

    const history = await paymentsService.listPayments(accountId, { limit: 10 });
    expect(history.payments.length).toBe(1);
    expect(history.payments[0].txHash).toBe(MOCK_TX_HASH);
    expect(history.payments[0].accountId).toBe(accountId);
  });

  // --- Multiple routes on same tenant ---

  it.skipIf(!available)('tenant can create multiple routes and pay on each', async () => {
    const { accountId } = await dashboardService.signup();

    await dashboardService.upsertRoute(accountId, {
      path: '/v1/alpha',
      priceWei: '100000',
      asset: 'USDC',
    });
    await dashboardService.upsertRoute(accountId, {
      path: '/v1/beta',
      priceWei: '200000',
      asset: 'USDC',
    });

    const routeA = await routesService.getRouteConfig(accountId, '/v1/alpha');
    const routeB = await routesService.getRouteConfig(accountId, '/v1/beta');
    expect(routeA.amountWei).toBe('100000');
    expect(routeB.amountWei).toBe('200000');

    mockVerifyPayment.mockResolvedValue({ ok: true, blockNumber: 50 });

    await enforceX402({
      headers: {
        'x-payment': JSON.stringify({
          nonce: 'multi_route_nce_a',
          txHash: MOCK_TX_HASH,
          signature: 's1',
        }),
      },
      route: routeA,
      accountId,
    });

    await enforceX402({
      headers: {
        'x-payment': JSON.stringify({
          nonce: 'multi_route_nce_b',
          txHash: MOCK_TX_HASH,
          signature: 's2',
        }),
      },
      route: routeB,
      accountId,
    });

    const yearMonth = new Date().toISOString().slice(0, 7);
    const usage = await docClient.send(
      new GetCommand({ TableName: 'x402-usage', Key: { accountId, yearMonth } }),
    );
    expect(usage.Item.callCount).toBe(2);
  });

  // --- Route update changes price ---

  it.skipIf(!available)(
    'route price update is reflected in subsequent route config lookup',
    async () => {
      const { accountId } = await dashboardService.signup();

      await dashboardService.upsertRoute(accountId, {
        path: '/v1/price-test',
        priceWei: '100',
        asset: 'USDC',
      });
      let config = await routesService.getRouteConfig(accountId, '/v1/price-test');
      expect(config.amountWei).toBe('100');

      // Update price
      await dashboardService.upsertRoute(accountId, {
        path: '/v1/price-test',
        priceWei: '999',
        asset: 'USDC',
      });
      config = await routesService.getRouteConfig(accountId, '/v1/price-test');
      expect(config.amountWei).toBe('999');
    },
  );

  // --- Route deletion prevents payment ---

  it.skipIf(!available)('deleted route is not retrievable for payment', async () => {
    const { accountId } = await dashboardService.signup();

    await dashboardService.upsertRoute(accountId, {
      path: '/v1/temp',
      priceWei: '5000',
      asset: 'USDC',
    });
    await dashboardService.removeRoute(accountId, '/v1/temp');

    try {
      await routesService.getRouteConfig(accountId, '/v1/temp');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e.constructor.name).toBe('NotFoundError');
    }
  });

  // --- API key rotation invalidates old key ---

  it.skipIf(!available)('rotated API key works, old key is rejected', async () => {
    const { accountId, apiKey: oldKey } = await dashboardService.signup();
    const { apiKey: newKey } = await dashboardService.rotateKey(accountId);

    // New key authenticates
    const auth = await authenticate({ 'x-api-key': newKey });
    expect(auth.accountId).toBe(accountId);

    // Old key fails
    try {
      await authenticate({ 'x-api-key': oldKey });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e.constructor.name).toBe('UnauthorizedError');
    }
  });

  // --- 402 challenge when no payment header ---

  it.skipIf(!available)(
    'x402 returns challenge with route details when no payment header',
    async () => {
      const { accountId } = await dashboardService.signup();
      await dashboardService.upsertRoute(accountId, {
        path: '/v1/paid',
        priceWei: '750000',
        asset: 'USDC',
      });

      const routeConfig = await routesService.getRouteConfig(accountId, '/v1/paid');

      try {
        await enforceX402({ headers: {}, route: routeConfig, accountId });
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e.constructor.name).toBe('PaymentRequiredError');
        expect(e.challenge.amountWei).toBe('750000');
        expect(e.challenge.assetSymbol).toBe('USDC');
        expect(e.challenge.payTo).toBe(MOCK_ADDRESS);
        expect(e.challenge.resource).toBe('/v1/paid');
      }
    },
  );

  // --- Two tenants are isolated ---

  it.skipIf(!available)('two tenants have isolated routes and payments', async () => {
    const tenantA = await dashboardService.signup();
    const tenantB = await dashboardService.signup();

    await dashboardService.upsertRoute(tenantA.accountId, {
      path: '/v1/shared-path',
      priceWei: '111',
      asset: 'USDC',
    });
    await dashboardService.upsertRoute(tenantB.accountId, {
      path: '/v1/shared-path',
      priceWei: '222',
      asset: 'USDC',
    });

    const configA = await routesService.getRouteConfig(tenantA.accountId, '/v1/shared-path');
    const configB = await routesService.getRouteConfig(tenantB.accountId, '/v1/shared-path');
    expect(configA.amountWei).toBe('111');
    expect(configB.amountWei).toBe('222');

    mockVerifyPayment.mockResolvedValue({ ok: true, blockNumber: 33 });

    await enforceX402({
      headers: {
        'x-payment': JSON.stringify({
          nonce: 'iso_tenant_a_nc1',
          txHash: MOCK_TX_HASH,
          signature: 'sa',
        }),
      },
      route: configA,
      accountId: tenantA.accountId,
    });

    const historyA = await paymentsService.listPayments(tenantA.accountId, { limit: 10 });
    const historyB = await paymentsService.listPayments(tenantB.accountId, { limit: 10 });
    expect(historyA.payments.length).toBe(1);
    expect(historyB.payments.length).toBe(0);
  });

  // --- List routes returns all tenant routes ---

  it.skipIf(!available)('listRoutes returns all routes for a tenant', async () => {
    const { accountId } = await dashboardService.signup();

    await dashboardService.upsertRoute(accountId, {
      path: '/v1/a',
      priceWei: '100',
      asset: 'USDC',
    });
    await dashboardService.upsertRoute(accountId, {
      path: '/v1/b',
      priceWei: '200',
      asset: 'USDC',
    });
    await dashboardService.upsertRoute(accountId, {
      path: '/v1/c',
      priceWei: '300',
      asset: 'USDC',
    });

    const routes = await dashboardService.listRoutes(accountId);
    expect(routes.length).toBe(3);

    const paths = routes.map((r) => r.path).sort();
    expect(paths).toEqual(['/v1/a', '/v1/b', '/v1/c']);
  });

  // --- Chain verification failure after route setup ---

  it.skipIf(!available)('chain verification failure does not record payment', async () => {
    const { accountId } = await dashboardService.signup();
    await dashboardService.upsertRoute(accountId, {
      path: '/v1/fail',
      priceWei: '1000000',
      asset: 'USDC',
    });

    mockVerifyPayment.mockResolvedValueOnce({ ok: false, reason: 'insufficient-amount' });

    const routeConfig = await routesService.getRouteConfig(accountId, '/v1/fail');
    const nonce = 'chain_fail_nonce1';

    try {
      await enforceX402({
        headers: { 'x-payment': JSON.stringify({ nonce, txHash: MOCK_TX_HASH, signature: 'sf' }) },
        route: routeConfig,
        accountId,
      });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e.constructor.name).toBe('PaymentRequiredError');
    }

    const payment = await docClient.send(
      new GetCommand({ TableName: 'x402-payments', Key: { idempotencyKey: nonce } }),
    );
    expect(payment.Item).toBeUndefined();

    const yearMonth = new Date().toISOString().slice(0, 7);
    const usage = await docClient.send(
      new GetCommand({ TableName: 'x402-usage', Key: { accountId, yearMonth } }),
    );
    expect(usage.Item).toBeUndefined();
  });

  // --- Multiple payments accumulate usage ---

  it.skipIf(!available)('three payments on same tenant accumulate usage count', async () => {
    const { accountId } = await dashboardService.signup();
    await dashboardService.upsertRoute(accountId, {
      path: '/v1/counted',
      priceWei: '50000',
      asset: 'USDC',
    });

    mockVerifyPayment.mockResolvedValue({ ok: true, blockNumber: 99 });
    const routeConfig = await routesService.getRouteConfig(accountId, '/v1/counted');

    for (let i = 0; i < 3; i++) {
      await enforceX402({
        headers: {
          'x-payment': JSON.stringify({
            nonce: `accum_nonce_000${i}`,
            txHash: MOCK_TX_HASH,
            signature: `s${i}`,
          }),
        },
        route: routeConfig,
        accountId,
      });
    }

    const yearMonth = new Date().toISOString().slice(0, 7);
    const usage = await docClient.send(
      new GetCommand({ TableName: 'x402-usage', Key: { accountId, yearMonth } }),
    );
    expect(usage.Item.callCount).toBe(3);

    const history = await paymentsService.listPayments(accountId, { limit: 10 });
    expect(history.payments.length).toBe(3);
  });

  // --- getRecentPayments from dashboard service ---

  it.skipIf(!available)(
    'dashboardService.getRecentPayments returns payment after x402 flow',
    async () => {
      const { accountId } = await dashboardService.signup();
      await dashboardService.upsertRoute(accountId, {
        path: '/v1/recent',
        priceWei: '888888',
        asset: 'USDC',
      });

      mockVerifyPayment.mockResolvedValueOnce({ ok: true, blockNumber: 5 });
      const routeConfig = await routesService.getRouteConfig(accountId, '/v1/recent');

      await enforceX402({
        headers: {
          'x-payment': JSON.stringify({
            nonce: 'recent_pay_nce01',
            txHash: MOCK_TX_HASH,
            signature: 'sr',
          }),
        },
        route: routeConfig,
        accountId,
      });

      const recent = await dashboardService.getRecentPayments(accountId);
      expect(recent.length).toBe(1);
      expect(recent[0].txHash).toBe(MOCK_TX_HASH);
      expect(recent[0].amountWei).toBe('888888');
    },
  );
});

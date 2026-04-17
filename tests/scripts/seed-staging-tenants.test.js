import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class MockDynamoDBClient {},
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
  PutCommand: class MockPutCommand {
    constructor(params) {
      Object.assign(this, params);
    }
  },
  GetCommand: class MockGetCommand {
    constructor(params) {
      Object.assign(this, params);
    }
  },
}));

const { createTenant, seedRoute, seedTenantPair } =
  await import('../../scripts/seed-staging-tenants.js');

describe('seed-staging-tenants', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('createTenant', () => {
    it('creates a new tenant when none exists', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});

      const result = await createTenant('acc-111');

      expect(result.accountId).toBe('acc-111');
      expect(result.apiKey).toMatch(/^x402_/);
      expect(result.existed).toBe(false);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('returns existed=true for existing tenant', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { accountId: 'acc-222', plan: 'starter' },
      });

      const result = await createTenant('acc-222');

      expect(result.existed).toBe(true);
      expect(result.apiKey).toBeNull();
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('uses specified plan', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});

      await createTenant('acc-333', 'growth');

      const putCall = mockSend.mock.calls[1][0];
      expect(putCall.Item.plan).toBe('growth');
    });

    it('defaults to starter plan', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});

      await createTenant('acc-444');

      const putCall = mockSend.mock.calls[1][0];
      expect(putCall.Item.plan).toBe('starter');
    });

    it('generates unique API keys', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});

      const r1 = await createTenant('a1');
      const r2 = await createTenant('a2');

      expect(r1.apiKey).not.toBe(r2.apiKey);
    });

    it('sets createdAt and updatedAt timestamps', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});

      await createTenant('acc-555');

      const putCall = mockSend.mock.calls[1][0];
      expect(putCall.Item.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(putCall.Item.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('includes apiKeyHash in DDB item', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});

      await createTenant('acc-666');

      const putCall = mockSend.mock.calls[1][0];
      expect(putCall.Item.apiKeyHash).toBeDefined();
      expect(putCall.Item.apiKeyHash.length).toBe(64);
    });

    it('propagates DDB errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('DDB timeout'));

      await expect(createTenant('acc-777')).rejects.toThrow('DDB timeout');
    });
  });

  describe('seedRoute', () => {
    it('puts route with correct fields', async () => {
      mockSend.mockResolvedValueOnce({});

      await seedRoute('tenant-1', '/v1/resource', '10000');

      const putCall = mockSend.mock.calls[0][0];
      expect(putCall.Item.tenantId).toBe('tenant-1');
      expect(putCall.Item.path).toBe('/v1/resource');
      expect(putCall.Item.priceWei).toBe('10000');
      expect(putCall.Item.asset).toBe('USDC');
    });

    it('sets timestamps', async () => {
      mockSend.mockResolvedValueOnce({});

      await seedRoute('t-1', '/v1/fetch', '5000');

      const putCall = mockSend.mock.calls[0][0];
      expect(putCall.Item.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(putCall.Item.updatedAt).toBe(putCall.Item.createdAt);
    });

    it('propagates DDB errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('throttled'));

      await expect(seedRoute('t-2', '/v1/resource', '10000')).rejects.toThrow('throttled');
    });
  });

  describe('seedTenantPair', () => {
    it('creates two tenants with routes', async () => {
      // tenant A: Get + Put
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      // tenant B: Get + Put
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      // routes: 3 for A, 1 for B = 4 PutCommands
      mockSend.mockResolvedValueOnce({});
      mockSend.mockResolvedValueOnce({});
      mockSend.mockResolvedValueOnce({});

      const result = await seedTenantPair();

      expect(result.tenantA.accountId).toBeDefined();
      expect(result.tenantB.accountId).toBeDefined();
      expect(result.tenantA.accountId).not.toBe(result.tenantB.accountId);
      // 2 Gets + 2 Puts (tenants) + 3 Puts (routes) = 7
      expect(mockSend).toHaveBeenCalledTimes(7);
    });

    it('tenant A gets starter plan, tenant B gets free plan', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      mockSend.mockResolvedValueOnce({});
      mockSend.mockResolvedValueOnce({});
      mockSend.mockResolvedValueOnce({});

      await seedTenantPair();

      const putA = mockSend.mock.calls[1][0];
      const putB = mockSend.mock.calls[3][0];
      expect(putA.Item.plan).toBe('starter');
      expect(putB.Item.plan).toBe('free');
    });

    it('seeds /v1/resource and /v1/fetch for tenant A', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      mockSend.mockResolvedValueOnce({});
      mockSend.mockResolvedValueOnce({});
      mockSend.mockResolvedValueOnce({});

      await seedTenantPair();

      const routePuts = mockSend.mock.calls.slice(4);
      const paths = routePuts.map((c) => c[0].Item.path);
      expect(paths).toContain('/v1/resource');
      expect(paths).toContain('/v1/fetch');
    });

    it('seeds only /v1/resource for tenant B', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      mockSend.mockResolvedValueOnce({});
      mockSend.mockResolvedValueOnce({});
      mockSend.mockResolvedValueOnce({});

      const result = await seedTenantPair();

      const routePuts = mockSend.mock.calls.slice(4);
      const tenantBRoutes = routePuts.filter(
        (c) => c[0].Item.tenantId === result.tenantB.accountId,
      );
      expect(tenantBRoutes.length).toBe(1);
      expect(tenantBRoutes[0][0].Item.path).toBe('/v1/resource');
    });

    it('propagates errors from createTenant', async () => {
      mockSend.mockRejectedValueOnce(new Error('access denied'));

      await expect(seedTenantPair()).rejects.toThrow('access denied');
    });
  });
});

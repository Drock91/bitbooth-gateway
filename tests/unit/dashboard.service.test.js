import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
const mockUpdateApiKeyHash = vi.fn();
const mockListByAccount = vi.fn();
const mockRouteUpdate = vi.fn();
const mockRouteCreate = vi.fn();
const mockRouteDelete = vi.fn();
const mockRouteListByTenant = vi.fn();

vi.mock('../../src/repositories/tenants.repo.js', () => ({
  tenantsRepo: {
    create: (...args) => mockCreate(...args),
    updateApiKeyHash: (...args) => mockUpdateApiKeyHash(...args),
  },
}));
vi.mock('../../src/repositories/payments.repo.js', () => ({
  paymentsRepo: { listByAccount: (...args) => mockListByAccount(...args) },
}));
vi.mock('../../src/repositories/routes.repo.js', () => ({
  routesRepo: {
    update: (...args) => mockRouteUpdate(...args),
    create: (...args) => mockRouteCreate(...args),
    delete: (...args) => mockRouteDelete(...args),
    listByTenant: (...args) => mockRouteListByTenant(...args),
  },
}));
vi.mock('../../src/lib/config.js', () => ({
  getConfig: () => ({ awsRegion: 'us-east-1' }),
}));

import { dashboardService } from '../../src/services/dashboard.service.js';

describe('dashboardService', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockUpdateApiKeyHash.mockReset();
    mockListByAccount.mockReset();
    mockRouteUpdate.mockReset();
    mockRouteCreate.mockReset();
    mockRouteDelete.mockReset();
    mockRouteListByTenant.mockReset();
  });

  describe('signup', () => {
    it('creates a tenant and returns accountId + raw API key', async () => {
      mockCreate.mockImplementation((input) => ({
        accountId: input.accountId,
        apiKeyHash: input.apiKeyHash,
        plan: input.plan ?? 'free',
        createdAt: '2026-04-05T00:00:00.000Z',
      }));

      const result = await dashboardService.signup();
      expect(result.accountId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(result.apiKey).toMatch(/^x402_[0-9a-f]{64}$/);
      expect(result.plan).toBe('free');
      expect(mockCreate).toHaveBeenCalledOnce();
    });

    it('passes apiKeyHash as SHA-256 hex to repo', async () => {
      mockCreate.mockImplementation((input) => ({
        accountId: input.accountId,
        apiKeyHash: input.apiKeyHash,
        plan: 'free',
        createdAt: '2026-04-05T00:00:00.000Z',
      }));

      await dashboardService.signup();
      const call = mockCreate.mock.calls[0][0];
      expect(call.apiKeyHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('propagates repo errors', async () => {
      mockCreate.mockRejectedValueOnce(new Error('boom'));
      await expect(dashboardService.signup()).rejects.toThrow('boom');
    });
  });

  describe('rotateKey', () => {
    it('generates new API key and updates repo', async () => {
      mockUpdateApiKeyHash.mockResolvedValueOnce({
        accountId: 'acc-1',
        apiKeyHash: 'newhash',
        plan: 'free',
        createdAt: '2026-04-06T00:00:00.000Z',
      });
      const result = await dashboardService.rotateKey('acc-1');
      expect(result.accountId).toBe('acc-1');
      expect(result.apiKey).toMatch(/^x402_[0-9a-f]{64}$/);
      expect(mockUpdateApiKeyHash).toHaveBeenCalledOnce();
    });

    it('passes SHA-256 hash of new key to repo', async () => {
      mockUpdateApiKeyHash.mockResolvedValueOnce({
        accountId: 'acc-1',
        apiKeyHash: 'h',
        plan: 'free',
        createdAt: '2026-04-06T00:00:00.000Z',
      });
      await dashboardService.rotateKey('acc-1');
      const call = mockUpdateApiKeyHash.mock.calls[0];
      expect(call[0]).toBe('acc-1');
      expect(call[1]).toMatch(/^[a-f0-9]{64}$/);
    });

    it('propagates repo errors', async () => {
      mockUpdateApiKeyHash.mockRejectedValueOnce(new Error('ddb failure'));
      await expect(dashboardService.rotateKey('acc-1')).rejects.toThrow('ddb failure');
    });

    it('generates unique keys on each call', async () => {
      mockUpdateApiKeyHash.mockResolvedValue({
        accountId: 'acc-1',
        apiKeyHash: 'h',
        plan: 'free',
        createdAt: '2026-04-06T00:00:00.000Z',
      });
      const r1 = await dashboardService.rotateKey('acc-1');
      const r2 = await dashboardService.rotateKey('acc-1');
      expect(r1.apiKey).not.toBe(r2.apiKey);
    });
  });

  describe('getRecentPayments', () => {
    it('returns payments from repo', async () => {
      const payments = [{ idempotencyKey: 'n1', amountWei: '100', status: 'confirmed' }];
      mockListByAccount.mockResolvedValueOnce({ items: payments, lastKey: null });

      const result = await dashboardService.getRecentPayments('acc-1');
      expect(result).toEqual(payments);
      expect(mockListByAccount).toHaveBeenCalledWith('acc-1', 20);
    });

    it('passes custom limit', async () => {
      mockListByAccount.mockResolvedValueOnce({ items: [], lastKey: null });
      await dashboardService.getRecentPayments('acc-1', 5);
      expect(mockListByAccount).toHaveBeenCalledWith('acc-1', 5);
    });
  });

  describe('upsertRoute', () => {
    const input = { path: '/v1/data', priceWei: '1000000', asset: 'USDC' };
    const routeItem = {
      tenantId: 'acc-1',
      ...input,
      createdAt: '2026-04-06T00:00:00.000Z',
      updatedAt: '2026-04-06T00:00:00.000Z',
    };

    it('updates existing route when update succeeds', async () => {
      mockRouteUpdate.mockResolvedValueOnce(routeItem);
      const result = await dashboardService.upsertRoute('acc-1', input);
      expect(result).toEqual(routeItem);
      expect(mockRouteUpdate).toHaveBeenCalledWith('acc-1', '/v1/data', input);
      expect(mockRouteCreate).not.toHaveBeenCalled();
    });

    it('falls back to create when update throws NotFoundError', async () => {
      mockRouteUpdate.mockRejectedValueOnce(new Error('Route not found'));
      mockRouteCreate.mockResolvedValueOnce(routeItem);
      const result = await dashboardService.upsertRoute('acc-1', input);
      expect(result).toEqual(routeItem);
      expect(mockRouteCreate).toHaveBeenCalledWith({ tenantId: 'acc-1', ...input });
    });

    it('propagates create errors on fallback', async () => {
      mockRouteUpdate.mockRejectedValueOnce(new Error('not found'));
      mockRouteCreate.mockRejectedValueOnce(new Error('ddb down'));
      await expect(dashboardService.upsertRoute('acc-1', input)).rejects.toThrow('ddb down');
    });
  });

  describe('removeRoute', () => {
    it('deletes route via repo', async () => {
      mockRouteDelete.mockResolvedValueOnce(undefined);
      await dashboardService.removeRoute('acc-1', '/v1/data');
      expect(mockRouteDelete).toHaveBeenCalledWith('acc-1', '/v1/data');
    });

    it('propagates repo errors', async () => {
      mockRouteDelete.mockRejectedValueOnce(new Error('not found'));
      await expect(dashboardService.removeRoute('acc-1', '/missing')).rejects.toThrow('not found');
    });
  });

  describe('listRoutes', () => {
    it('returns routes from repo', async () => {
      const routes = [{ tenantId: 'acc-1', path: '/v1/a', priceWei: '100', asset: 'USDC' }];
      mockRouteListByTenant.mockResolvedValueOnce(routes);
      const result = await dashboardService.listRoutes('acc-1');
      expect(result).toEqual(routes);
      expect(mockRouteListByTenant).toHaveBeenCalledWith('acc-1');
    });

    it('returns empty array when no routes', async () => {
      mockRouteListByTenant.mockResolvedValueOnce([]);
      const result = await dashboardService.listRoutes('acc-1');
      expect(result).toEqual([]);
    });
  });
});

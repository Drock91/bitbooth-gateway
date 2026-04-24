import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockScanAllConfirmed = vi.hoisted(() => vi.fn());
const mockScanEventsSince = vi.hoisted(() => vi.fn());
const mockListAll = vi.hoisted(() => vi.fn());

vi.mock('../../src/repositories/payments.repo.js', () => ({
  paymentsRepo: { scanAllConfirmed: mockScanAllConfirmed },
}));
vi.mock('../../src/repositories/fraud.repo.js', () => ({
  fraudRepo: { scanEventsSince: mockScanEventsSince },
}));
vi.mock('../../src/repositories/tenants.repo.js', () => ({
  tenantsRepo: { listAll: mockListAll },
}));
vi.mock('../../src/lib/config.js', () => ({
  getConfig: () => ({ awsRegion: 'us-east-1' }),
}));

import { metricsService } from '../../src/services/metrics.service.js';

function makePayment(accountId, amountWei = '10000') {
  return { accountId, amountWei, status: 'confirmed' };
}

function makeFraudEvent(hoursAgo) {
  const ts = new Date(Date.now() - hoursAgo * 3600_000).toISOString();
  return { accountId: 'acc-1', timestamp: ts, eventType: 'velocity', severity: 'medium' };
}

describe('metricsService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    metricsService._resetCache();
    mockListAll.mockResolvedValue({ items: [], lastKey: undefined });
    mockScanAllConfirmed.mockResolvedValue([]);
    mockScanEventsSince.mockResolvedValue([]);
  });

  describe('getDashboard', () => {
    it('returns all metric fields', async () => {
      const result = await metricsService.getDashboard();
      expect(result).toHaveProperty('mrr');
      expect(result).toHaveProperty('payingCount');
      expect(result).toHaveProperty('mrrByPlan');
      expect(result).toHaveProperty('countByPlan');
      expect(result).toHaveProperty('total402s');
      expect(result).toHaveProperty('totalUsdc');
      expect(result).toHaveProperty('fetchesTotal');
      expect(result).toHaveProperty('fetchRevenueUsdc');
      expect(result).toHaveProperty('fraudCounts');
      expect(result).toHaveProperty('topTenants');
    });

    it('computes MRR from active paid tenants', async () => {
      mockListAll.mockResolvedValue({
        items: [
          { plan: 'starter', status: 'active' },
          { plan: 'growth', status: 'active' },
          { plan: 'free', status: 'active' },
          { plan: 'scale', status: 'suspended' },
        ],
        lastKey: undefined,
      });
      const result = await metricsService.getDashboard();
      expect(result.mrr).toBe(148);
      expect(result.payingCount).toBe(2);
    });

    it('counts confirmed payments as total402s', async () => {
      mockScanAllConfirmed.mockResolvedValue([
        makePayment('acc-1'),
        makePayment('acc-2'),
        makePayment('acc-1'),
      ]);
      const result = await metricsService.getDashboard();
      expect(result.total402s).toBe(3);
    });

    it('sums amountWei and converts to USDC', async () => {
      mockScanAllConfirmed.mockResolvedValue([
        makePayment('acc-1', '5000000'),
        makePayment('acc-2', '3000000'),
      ]);
      const result = await metricsService.getDashboard();
      expect(result.totalUsdc).toBe(8);
    });

    it('counts fetch payments by resource field', async () => {
      mockScanAllConfirmed.mockResolvedValue([
        { accountId: 'a1', amountWei: '5000', resource: '/v1/fetch' },
        { accountId: 'a2', amountWei: '10000', resource: '/v1/resource' },
        { accountId: 'a1', amountWei: '5000', resource: '/v1/fetch' },
        { accountId: 'a3', amountWei: '5000' },
      ]);
      const result = await metricsService.getDashboard();
      expect(result.fetchesTotal).toBe(2);
      expect(result.fetchRevenueUsdc).toBeCloseTo(0.01);
    });

    it('returns zero fetch stats when no fetch payments exist', async () => {
      mockScanAllConfirmed.mockResolvedValue([makePayment('acc-1', '10000')]);
      const result = await metricsService.getDashboard();
      expect(result.fetchesTotal).toBe(0);
      expect(result.fetchRevenueUsdc).toBe(0);
    });

    it('returns zero fetch stats on empty dataset', async () => {
      const result = await metricsService.getDashboard();
      expect(result.fetchesTotal).toBe(0);
      expect(result.fetchRevenueUsdc).toBe(0);
    });

    it('computes fraud counts by time window', async () => {
      mockScanEventsSince.mockResolvedValue([
        makeFraudEvent(1),
        makeFraudEvent(12),
        makeFraudEvent(48),
        makeFraudEvent(168),
        makeFraudEvent(500),
      ]);
      const result = await metricsService.getDashboard();
      expect(result.fraudCounts.h24).toBe(2);
      expect(result.fraudCounts.h7d).toBe(4);
      expect(result.fraudCounts.h30d).toBe(5);
    });

    it('returns top 10 tenants sorted by payment count', async () => {
      const payments = [];
      for (let i = 0; i < 12; i++) {
        const acc = `acc-${i}`;
        for (let j = 0; j <= i; j++) payments.push(makePayment(acc));
      }
      mockScanAllConfirmed.mockResolvedValue(payments);
      const result = await metricsService.getDashboard();
      expect(result.topTenants).toHaveLength(10);
      expect(result.topTenants[0].accountId).toBe('acc-11');
      expect(result.topTenants[0].paymentCount).toBe(12);
    });

    it('handles empty datasets', async () => {
      const result = await metricsService.getDashboard();
      expect(result.total402s).toBe(0);
      expect(result.totalUsdc).toBe(0);
      expect(result.mrr).toBe(0);
      expect(result.payingCount).toBe(0);
      expect(result.fraudCounts).toEqual({ h24: 0, h7d: 0, h30d: 0 });
      expect(result.topTenants).toEqual([]);
    });

    it('caches results for subsequent calls', async () => {
      await metricsService.getDashboard();
      await metricsService.getDashboard();
      expect(mockScanAllConfirmed).toHaveBeenCalledTimes(1);
      expect(mockScanEventsSince).toHaveBeenCalledTimes(1);
      expect(mockListAll).toHaveBeenCalledTimes(1);
    });

    it('refreshes after cache reset', async () => {
      await metricsService.getDashboard();
      metricsService._resetCache();
      await metricsService.getDashboard();
      expect(mockScanAllConfirmed).toHaveBeenCalledTimes(2);
    });

    it('paginates tenant scan', async () => {
      mockListAll
        .mockResolvedValueOnce({
          items: [{ plan: 'starter', status: 'active' }],
          lastKey: { accountId: 'cursor' },
        })
        .mockResolvedValueOnce({
          items: [{ plan: 'growth', status: 'active' }],
          lastKey: undefined,
        });
      const result = await metricsService.getDashboard();
      expect(result.mrr).toBe(148);
      expect(mockListAll).toHaveBeenCalledTimes(2);
    });

    it('treats null status as active', async () => {
      mockListAll.mockResolvedValue({
        items: [{ plan: 'starter' }],
        lastKey: undefined,
      });
      const result = await metricsService.getDashboard();
      expect(result.mrr).toBe(49);
      expect(result.payingCount).toBe(1);
    });

    it('handles payments with null amountWei', async () => {
      mockScanAllConfirmed.mockResolvedValue([{ accountId: 'acc-1', amountWei: null }]);
      const result = await metricsService.getDashboard();
      expect(result.total402s).toBe(1);
      expect(result.totalUsdc).toBe(0);
    });

    it('handles payments with no accountId', async () => {
      mockScanAllConfirmed.mockResolvedValue([{ amountWei: '10000' }]);
      const result = await metricsService.getDashboard();
      expect(result.total402s).toBe(1);
      expect(result.topTenants).toEqual([]);
    });

    it('aggregates USDC per tenant in topTenants', async () => {
      mockScanAllConfirmed.mockResolvedValue([
        makePayment('acc-1', '1000000'),
        makePayment('acc-1', '2000000'),
      ]);
      const result = await metricsService.getDashboard();
      expect(result.topTenants[0].totalUsdcMicro).toBe(3000000);
      expect(result.topTenants[0].paymentCount).toBe(2);
    });

    it('runs scans in parallel', async () => {
      const order = [];
      mockListAll.mockImplementation(async () => {
        order.push('tenants');
        return { items: [], lastKey: undefined };
      });
      mockScanAllConfirmed.mockImplementation(async () => {
        order.push('payments');
        return [];
      });
      mockScanEventsSince.mockImplementation(async () => {
        order.push('fraud');
        return [];
      });
      await metricsService.getDashboard();
      expect(order).toHaveLength(3);
    });

    it('passes 30-day-ago ISO to scanEventsSince', async () => {
      await metricsService.getDashboard();
      const arg = mockScanEventsSince.mock.calls[0][0];
      const parsed = new Date(arg);
      const daysAgo = (Date.now() - parsed.getTime()) / (24 * 3600_000);
      expect(daysAgo).toBeCloseTo(30, 0);
    });

    it('treats unknown plan as $0', async () => {
      mockListAll.mockResolvedValue({
        items: [{ plan: 'enterprise', status: 'active' }],
        lastKey: undefined,
      });
      const result = await metricsService.getDashboard();
      expect(result.mrr).toBe(0);
      expect(result.payingCount).toBe(0);
    });

    it('breaks down MRR by plan tier', async () => {
      mockListAll.mockResolvedValue({
        items: [
          { plan: 'starter', status: 'active' },
          { plan: 'starter', status: 'active' },
          { plan: 'growth', status: 'active' },
          { plan: 'scale', status: 'active' },
          { plan: 'free', status: 'active' },
        ],
        lastKey: undefined,
      });
      const result = await metricsService.getDashboard();
      expect(result.mrrByPlan).toEqual({ free: 0, starter: 98, growth: 99, scale: 299 });
      expect(result.mrr).toBe(496);
    });

    it('counts tenants by plan tier', async () => {
      mockListAll.mockResolvedValue({
        items: [
          { plan: 'free', status: 'active' },
          { plan: 'free', status: 'active' },
          { plan: 'starter', status: 'active' },
          { plan: 'growth', status: 'suspended' },
        ],
        lastKey: undefined,
      });
      const result = await metricsService.getDashboard();
      expect(result.countByPlan).toEqual({ free: 2, starter: 1, growth: 1, scale: 0 });
    });

    it('excludes suspended tenants from mrrByPlan', async () => {
      mockListAll.mockResolvedValue({
        items: [
          { plan: 'starter', status: 'active' },
          { plan: 'starter', status: 'suspended' },
        ],
        lastKey: undefined,
      });
      const result = await metricsService.getDashboard();
      expect(result.mrrByPlan.starter).toBe(49);
    });

    it('returns zero mrrByPlan on empty dataset', async () => {
      const result = await metricsService.getDashboard();
      expect(result.mrrByPlan).toEqual({ free: 0, starter: 0, growth: 0, scale: 0 });
      expect(result.countByPlan).toEqual({ free: 0, starter: 0, growth: 0, scale: 0 });
    });

    it('defaults null plan to free in countByPlan', async () => {
      mockListAll.mockResolvedValue({
        items: [{ status: 'active' }],
        lastKey: undefined,
      });
      const result = await metricsService.getDashboard();
      expect(result.countByPlan.free).toBe(1);
    });

    it('fraud events exactly at 24h boundary count in 24h', async () => {
      mockScanEventsSince.mockResolvedValue([makeFraudEvent(24)]);
      const result = await metricsService.getDashboard();
      expect(result.fraudCounts.h24).toBe(1);
    });

    it('topTenants limited to 10 even with more accounts', async () => {
      const payments = Array.from({ length: 15 }, (_, i) => makePayment(`acc-${i}`));
      mockScanAllConfirmed.mockResolvedValue(payments);
      const result = await metricsService.getDashboard();
      expect(result.topTenants).toHaveLength(10);
    });
  });

  describe('_resetCache', () => {
    it('clears cached metrics', async () => {
      await metricsService.getDashboard();
      metricsService._resetCache();
      mockScanAllConfirmed.mockResolvedValue([makePayment('acc-1')]);
      const result = await metricsService.getDashboard();
      expect(result.total402s).toBe(1);
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  parseArgs,
  computeMrr,
  computePaymentStats,
  detectNewFirstPayers,
  buildEmfMetrics,
  updateNorthStar,
  sendNtfy,
} from '../../scripts/revenue-tracker.js';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual('node:fs');
  return { ...actual, readFileSync: vi.fn(), writeFileSync: vi.fn() };
});

describe('revenue-tracker', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('parseArgs', () => {
    it('returns dryRun false by default', () => {
      expect(parseArgs(['node', 'script.js'])).toEqual({ dryRun: false });
    });

    it('sets dryRun true with --dry-run', () => {
      expect(parseArgs(['node', 'script.js', '--dry-run'])).toEqual({ dryRun: true });
    });

    it('ignores unknown flags', () => {
      expect(parseArgs(['node', 'script.js', '--verbose'])).toEqual({ dryRun: false });
    });
  });

  describe('computeMrr', () => {
    it('returns 0 for empty tenants', () => {
      expect(computeMrr([])).toEqual({ mrr: 0, payingCount: 0 });
    });

    it('returns 0 for all free tenants', () => {
      const tenants = [
        { plan: 'free', status: 'active' },
        { plan: 'free', status: 'active' },
      ];
      expect(computeMrr(tenants)).toEqual({ mrr: 0, payingCount: 0 });
    });

    it('computes MRR for starter plan', () => {
      const tenants = [{ plan: 'starter', status: 'active' }];
      expect(computeMrr(tenants)).toEqual({ mrr: 49, payingCount: 1 });
    });

    it('computes MRR for growth plan', () => {
      const tenants = [{ plan: 'growth', status: 'active' }];
      expect(computeMrr(tenants)).toEqual({ mrr: 99, payingCount: 1 });
    });

    it('computes MRR for scale plan', () => {
      const tenants = [{ plan: 'scale', status: 'active' }];
      expect(computeMrr(tenants)).toEqual({ mrr: 299, payingCount: 1 });
    });

    it('sums multiple paying plans', () => {
      const tenants = [
        { plan: 'starter', status: 'active' },
        { plan: 'growth', status: 'active' },
        { plan: 'scale', status: 'active' },
        { plan: 'free', status: 'active' },
      ];
      expect(computeMrr(tenants)).toEqual({ mrr: 447, payingCount: 3 });
    });

    it('excludes suspended tenants', () => {
      const tenants = [
        { plan: 'starter', status: 'suspended' },
        { plan: 'growth', status: 'active' },
      ];
      expect(computeMrr(tenants)).toEqual({ mrr: 99, payingCount: 1 });
    });

    it('treats missing status as active', () => {
      const tenants = [{ plan: 'starter' }];
      expect(computeMrr(tenants)).toEqual({ mrr: 49, payingCount: 1 });
    });

    it('treats unknown plan as free', () => {
      const tenants = [{ plan: 'enterprise', status: 'active' }];
      expect(computeMrr(tenants)).toEqual({ mrr: 0, payingCount: 0 });
    });
  });

  describe('computePaymentStats', () => {
    it('returns zeros for empty payments', () => {
      const result = computePaymentStats([]);
      expect(result.lifetimeFetches).toBe(0);
      expect(result.lifetimeUsdc).toBe(0);
      expect(result.accountFirstSeen.size).toBe(0);
    });

    it('counts confirmed payments in USDC', () => {
      const payments = [
        { status: 'confirmed', amountWei: '5000', accountId: 'a1', createdAt: '2026-01-01' },
        { status: 'confirmed', amountWei: '10000', accountId: 'a2', createdAt: '2026-01-02' },
      ];
      const result = computePaymentStats(payments);
      expect(result.lifetimeUsdc).toBe(0.015);
      expect(result.accountFirstSeen.size).toBe(2);
    });

    it('ignores non-confirmed payments', () => {
      const payments = [{ status: 'pending', amountWei: '5000', accountId: 'a1' }];
      const result = computePaymentStats(payments);
      expect(result.lifetimeUsdc).toBe(0);
      expect(result.accountFirstSeen.size).toBe(0);
    });

    it('counts fetch payments by idempotency key', () => {
      const payments = [
        {
          status: 'confirmed',
          amountWei: '5000',
          idempotencyKey: 'nonce-/v1/fetch-abc',
          accountId: 'a1',
          createdAt: '2026-01-01',
        },
        {
          status: 'confirmed',
          amountWei: '5000',
          idempotencyKey: 'nonce-/v1/resource-def',
          accountId: 'a2',
          createdAt: '2026-01-01',
        },
        {
          status: 'confirmed',
          amountWei: '5000',
          idempotencyKey: 'nonce-/v1/fetch-ghi',
          accountId: 'a1',
          createdAt: '2026-01-02',
        },
      ];
      const result = computePaymentStats(payments);
      expect(result.lifetimeFetches).toBe(2);
    });

    it('tracks first-seen per account', () => {
      const payments = [
        { status: 'confirmed', amountWei: '100', accountId: 'a1', createdAt: '2026-01-01' },
        { status: 'confirmed', amountWei: '200', accountId: 'a1', createdAt: '2026-01-05' },
      ];
      const result = computePaymentStats(payments);
      expect(result.accountFirstSeen.size).toBe(1);
      expect(result.accountFirstSeen.get('a1')).toBe('2026-01-01');
    });

    it('handles missing amountWei gracefully', () => {
      const payments = [{ status: 'confirmed', accountId: 'a1', createdAt: '2026-01-01' }];
      const result = computePaymentStats(payments);
      expect(result.lifetimeUsdc).toBe(0);
    });
  });

  describe('detectNewFirstPayers', () => {
    it('returns true when more accounts than previous count', () => {
      const map = new Map([
        ['a1', '2026-01-01'],
        ['a2', '2026-01-02'],
      ]);
      expect(detectNewFirstPayers(map, 1)).toBe(true);
    });

    it('returns false when same count', () => {
      const map = new Map([['a1', '2026-01-01']]);
      expect(detectNewFirstPayers(map, 1)).toBe(false);
    });

    it('returns false when fewer accounts', () => {
      const map = new Map();
      expect(detectNewFirstPayers(map, 5)).toBe(false);
    });

    it('returns true when first-ever payer', () => {
      const map = new Map([['a1', '2026-01-01']]);
      expect(detectNewFirstPayers(map, 0)).toBe(true);
    });
  });

  describe('buildEmfMetrics', () => {
    it('produces valid EMF structure', () => {
      const emf = buildEmfMetrics({
        mrr: 148,
        payingCount: 3,
        lifetimeFetches: 42,
        lifetimeUsdc: 0.21,
      });

      expect(emf._aws).toBeDefined();
      expect(emf._aws.CloudWatchMetrics).toHaveLength(1);
      expect(emf._aws.CloudWatchMetrics[0].Namespace).toBe('x402/revenue');
      expect(emf._aws.CloudWatchMetrics[0].Metrics).toHaveLength(4);
      expect(emf.mrr_usd).toBe(148);
      expect(emf.paying_tenants).toBe(3);
      expect(emf.lifetime_fetches).toBe(42);
      expect(emf.lifetime_usdc_collected).toBe(0.21);
    });

    it('includes a timestamp', () => {
      const before = Date.now();
      const emf = buildEmfMetrics({ mrr: 0, payingCount: 0, lifetimeFetches: 0, lifetimeUsdc: 0 });
      expect(emf._aws.Timestamp).toBeGreaterThanOrEqual(before);
    });

    it('uses empty dimensions array', () => {
      const emf = buildEmfMetrics({ mrr: 0, payingCount: 0, lifetimeFetches: 0, lifetimeUsdc: 0 });
      expect(emf._aws.CloudWatchMetrics[0].Dimensions).toEqual([[]]);
    });
  });

  describe('updateNorthStar', () => {
    const nsPath = '/tmp/test-north-star.json';
    const baseNs = {
      schemaVersion: 1,
      mrr_usd: 0,
      paying_tenants_count: 0,
      lifetime_fetches: 0,
      lifetime_usdc_collected: 0,
    };

    beforeEach(() => {
      readFileSync.mockReturnValue(JSON.stringify(baseNs));
    });

    it('updates all fields and returns prev/current', () => {
      const result = updateNorthStar(nsPath, {
        mrr: 99,
        payingCount: 2,
        lifetimeFetches: 10,
        lifetimeUsdc: 0.05,
      });

      expect(result.prev).toEqual({ mrr: 0, paying: 0, fetches: 0, usdc: 0 });
      expect(result.current).toEqual({ mrr: 99, paying: 2, fetches: 10, usdc: 0.05 });
      expect(writeFileSync).toHaveBeenCalledOnce();
    });

    it('writes updated JSON to disk', () => {
      updateNorthStar(nsPath, { mrr: 49, payingCount: 1, lifetimeFetches: 5, lifetimeUsdc: 0.025 });

      const written = JSON.parse(writeFileSync.mock.calls[0][1]);
      expect(written.mrr_usd).toBe(49);
      expect(written.paying_tenants_count).toBe(1);
      expect(written.lifetime_fetches).toBe(5);
      expect(written.lifetime_usdc_collected).toBe(0.025);
      expect(written.last_updated).toBeDefined();
    });

    it('does not write in dry-run mode', () => {
      const result = updateNorthStar(
        nsPath,
        { mrr: 99, payingCount: 1, lifetimeFetches: 5, lifetimeUsdc: 0.05 },
        { dryRun: true },
      );

      expect(writeFileSync).not.toHaveBeenCalled();
      expect(result.current.mrr).toBe(99);
    });

    it('preserves existing NORTH_STAR fields', () => {
      readFileSync.mockReturnValue(
        JSON.stringify({ ...baseNs, deployed_staging: true, real_402_issued_count: 5 }),
      );

      updateNorthStar(nsPath, { mrr: 49, payingCount: 1, lifetimeFetches: 0, lifetimeUsdc: 0 });

      const written = JSON.parse(writeFileSync.mock.calls[0][1]);
      expect(written.deployed_staging).toBe(true);
      expect(written.real_402_issued_count).toBe(5);
    });

    it('handles missing fields in existing file', () => {
      readFileSync.mockReturnValue(JSON.stringify({ schemaVersion: 1 }));

      const result = updateNorthStar(nsPath, {
        mrr: 49,
        payingCount: 1,
        lifetimeFetches: 3,
        lifetimeUsdc: 0.015,
      });

      expect(result.prev).toEqual({ mrr: 0, paying: 0, fetches: 0, usdc: 0 });
    });
  });

  describe('sendNtfy', () => {
    let fetchSpy;

    beforeEach(() => {
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true });
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it('returns false when no topic', async () => {
      expect(await sendNtfy(null, 'test')).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('returns false for empty topic', async () => {
      expect(await sendNtfy('', 'test')).toBe(false);
    });

    it('sends POST to ntfy.sh with topic', async () => {
      await sendNtfy('x402-test', 'Hello world');

      expect(fetchSpy).toHaveBeenCalledWith('https://ntfy.sh/x402-test', {
        method: 'POST',
        headers: { Title: 'x402 Revenue Alert', Priority: '4', Tags: 'money_with_wings' },
        body: 'Hello world',
      });
    });

    it('returns true on success', async () => {
      expect(await sendNtfy('x402-test', 'msg')).toBe(true);
    });

    it('returns false on failure', async () => {
      fetchSpy.mockResolvedValue({ ok: false });
      expect(await sendNtfy('x402-test', 'msg')).toBe(false);
    });
  });
});

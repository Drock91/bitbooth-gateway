import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockIncrementTally, mockRecordEvent } = vi.hoisted(() => ({
  mockIncrementTally: vi.fn(),
  mockRecordEvent: vi.fn(),
}));

vi.mock('../../src/repositories/fraud.repo.js', () => ({
  fraudRepo: {
    incrementTally: mockIncrementTally,
    recordEvent: mockRecordEvent,
  },
}));

import { fraudService } from '../../src/services/fraud.service.js';
import { FraudDetectedError } from '../../src/lib/errors.js';

const ACC = 'acct-edge-1';

function tallyResult(count) {
  return {
    accountId: ACC,
    windowKey: 'test',
    eventCount: count,
    lastEventAt: new Date().toISOString(),
  };
}

describe('fraudService — edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordEvent.mockResolvedValue({});
  });

  // ── Amount bounds ──────────────────────────────────────────────

  describe('checkAmount boundary precision', () => {
    const rules = { minAmountWei: '1000', maxAmountWei: '100000000000000000000' };

    it('allows exact minimum boundary', async () => {
      await expect(fraudService.checkAmount('1000', rules)).resolves.not.toThrow();
    });

    it('rejects one below minimum', async () => {
      await expect(fraudService.checkAmount('999', rules)).rejects.toThrow(FraudDetectedError);
    });

    it('allows exact maximum boundary', async () => {
      await expect(fraudService.checkAmount('100000000000000000000', rules)).resolves.not.toThrow();
    });

    it('rejects one above maximum', async () => {
      await expect(fraudService.checkAmount('100000000000000000001', rules)).rejects.toThrow(
        FraudDetectedError,
      );
    });

    it('rejects negative amount', async () => {
      await expect(fraudService.checkAmount('-1', rules)).rejects.toThrow();
    });

    it('allows min == max (single valid amount)', async () => {
      const narrow = { minAmountWei: '5000', maxAmountWei: '5000' };
      await expect(fraudService.checkAmount('5000', narrow)).resolves.not.toThrow();
    });

    it('rejects when min == max and amount differs by 1', async () => {
      const narrow = { minAmountWei: '5000', maxAmountWei: '5000' };
      await expect(fraudService.checkAmount('5001', narrow)).rejects.toThrow(FraudDetectedError);
      await expect(fraudService.checkAmount('4999', narrow)).rejects.toThrow(FraudDetectedError);
    });

    it('handles very large BigInt amounts within bounds', async () => {
      const big = { minAmountWei: '1', maxAmountWei: '999999999999999999999999999999' };
      await expect(
        fraudService.checkAmount('999999999999999999999999999999', big),
      ).resolves.not.toThrow();
    });

    it('error details include actual amount and rule bounds', async () => {
      try {
        await fraudService.checkAmount('500', rules);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(FraudDetectedError);
        expect(e.details).toEqual(
          expect.objectContaining({
            rule: 'abnormal_amount',
            amountWei: '500',
            minWei: '1000',
            maxWei: '100000000000000000000',
          }),
        );
      }
    });
  });

  // ── Velocity window keys ───────────────────────────────────────

  describe('velocity window key format', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('minute window key changes every minute', async () => {
      vi.useFakeTimers({ now: new Date('2026-04-06T10:05:30Z') });
      mockIncrementTally.mockResolvedValue(tallyResult(1));

      await fraudService.checkVelocity(ACC, { maxPaymentsPerMinute: 10, maxPaymentsPerHour: 100 });
      const minuteKey = mockIncrementTally.mock.calls[0][1];
      expect(minuteKey).toBe('velocity:2026-04-06T10:05');
    });

    it('hour window key changes every hour', async () => {
      vi.useFakeTimers({ now: new Date('2026-04-06T10:05:30Z') });
      mockIncrementTally.mockResolvedValue(tallyResult(1));

      await fraudService.checkVelocity(ACC, { maxPaymentsPerMinute: 10, maxPaymentsPerHour: 100 });
      const hourKey = mockIncrementTally.mock.calls[1][1];
      expect(hourKey).toBe('velocity-h:2026-04-06T10');
    });

    it('nonce failure uses minute-granularity key', async () => {
      vi.useFakeTimers({ now: new Date('2026-04-06T23:59:00Z') });
      mockIncrementTally.mockResolvedValue(tallyResult(1));

      await fraudService.trackNonceFailure(ACC);
      const key = mockIncrementTally.mock.calls[0][1];
      expect(key).toBe('nonce-fail:2026-04-06T23:59');
    });

    it('window key rolls over at minute boundary', async () => {
      vi.useFakeTimers({ now: new Date('2026-04-06T10:05:59Z') });
      mockIncrementTally.mockResolvedValue(tallyResult(1));
      await fraudService.checkVelocity(ACC, { maxPaymentsPerMinute: 10, maxPaymentsPerHour: 100 });
      const key1 = mockIncrementTally.mock.calls[0][1];

      vi.setSystemTime(new Date('2026-04-06T10:06:00Z'));
      mockIncrementTally.mockClear();
      mockIncrementTally.mockResolvedValue(tallyResult(1));
      await fraudService.checkVelocity(ACC, { maxPaymentsPerMinute: 10, maxPaymentsPerHour: 100 });
      const key2 = mockIncrementTally.mock.calls[0][1];

      expect(key1).toBe('velocity:2026-04-06T10:05');
      expect(key2).toBe('velocity:2026-04-06T10:06');
      expect(key1).not.toBe(key2);
    });
  });

  // ── Concurrent nonce attempts ──────────────────────────────────

  describe('concurrent nonce failure tracking', () => {
    it('parallel trackNonceFailure calls each increment tally independently', async () => {
      let callCount = 0;
      mockIncrementTally.mockImplementation(async () => {
        callCount++;
        return tallyResult(callCount);
      });

      await Promise.all([
        fraudService.trackNonceFailure(ACC),
        fraudService.trackNonceFailure(ACC),
        fraudService.trackNonceFailure(ACC),
      ]);

      expect(mockIncrementTally).toHaveBeenCalledTimes(3);
    });

    it('parallel calls throw when threshold exceeded mid-batch', async () => {
      mockIncrementTally
        .mockResolvedValueOnce(tallyResult(2))
        .mockResolvedValueOnce(tallyResult(3))
        .mockResolvedValueOnce(tallyResult(4)); // exceeds default 3

      const results = await Promise.allSettled([
        fraudService.trackNonceFailure(ACC),
        fraudService.trackNonceFailure(ACC),
        fraudService.trackNonceFailure(ACC),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled.length).toBe(2);
      expect(rejected.length).toBe(1);
      expect(rejected[0].reason).toBeInstanceOf(FraudDetectedError);
    });

    it('parallel velocity checks each call incrementTally twice', async () => {
      mockIncrementTally.mockResolvedValue(tallyResult(1));
      const rules = { maxPaymentsPerMinute: 100, maxPaymentsPerHour: 1000 };

      await Promise.all([
        fraudService.checkVelocity(ACC, rules),
        fraudService.checkVelocity(ACC, rules),
      ]);

      // Each checkVelocity increments minute + hour = 2 calls each
      expect(mockIncrementTally).toHaveBeenCalledTimes(4);
    });
  });

  // ── checkPrePayment edge cases ─────────────────────────────────

  describe('checkPrePayment edge cases', () => {
    it('repo error in incrementTally propagates as-is', async () => {
      mockIncrementTally.mockRejectedValue(new Error('DDB throttled'));
      await expect(
        fraudService.checkPrePayment({ accountId: ACC, amountWei: '5000' }),
      ).rejects.toThrow('DDB throttled');
    });

    it('partial fraudRules override merges with defaults', async () => {
      mockIncrementTally.mockResolvedValue(tallyResult(1));
      // Override only maxAmountWei; minAmountWei stays at default 1000
      await expect(
        fraudService.checkPrePayment({
          accountId: ACC,
          amountWei: '2000',
          fraudRules: { maxAmountWei: '3000' },
        }),
      ).resolves.not.toThrow();
    });

    it('velocity and amount checks run in parallel (not sequentially)', async () => {
      let velocityStarted = false;
      let amountCheckedWhileVelocityPending = false;

      mockIncrementTally.mockImplementation(async () => {
        velocityStarted = true;
        // Simulate slow DDB
        await new Promise((r) => setTimeout(r, 10));
        return tallyResult(1);
      });

      const originalCheckAmount = fraudService.checkAmount.bind(fraudService);
      const spy = vi.spyOn(fraudService, 'checkAmount').mockImplementation(async (...args) => {
        if (velocityStarted) amountCheckedWhileVelocityPending = true;
        return originalCheckAmount(...args);
      });

      await fraudService.checkPrePayment({ accountId: ACC, amountWei: '5000' });
      expect(amountCheckedWhileVelocityPending).toBe(true);
      spy.mockRestore();
    });

    it('minute velocity breach takes priority over hour breach', async () => {
      mockIncrementTally
        .mockResolvedValueOnce(tallyResult(6)) // minute > 5
        .mockResolvedValueOnce(tallyResult(61)); // hour > 60

      try {
        await fraudService.checkPrePayment({ accountId: ACC, amountWei: '5000' });
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(FraudDetectedError);
        expect(e.details.window).toBe('1m');
      }
    });

    it('velocity at exact threshold does not trip (uses > not >=)', async () => {
      mockIncrementTally
        .mockResolvedValueOnce(tallyResult(5)) // minute exactly at limit
        .mockResolvedValueOnce(tallyResult(60)); // hour exactly at limit
      await expect(
        fraudService.checkPrePayment({ accountId: ACC, amountWei: '5000' }),
      ).resolves.not.toThrow();
    });

    it('nonce failure at exact threshold does not trip', async () => {
      mockIncrementTally.mockResolvedValue(tallyResult(3)); // exactly at default 3
      await expect(fraudService.trackNonceFailure(ACC)).resolves.not.toThrow();
    });
  });
});

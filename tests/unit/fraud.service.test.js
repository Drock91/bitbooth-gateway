import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const ACC = 'acct-test-1';

function tallyResult(count) {
  return {
    accountId: ACC,
    windowKey: 'test',
    eventCount: count,
    lastEventAt: new Date().toISOString(),
  };
}

describe('fraudService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordEvent.mockResolvedValue({});
  });

  describe('checkPrePayment', () => {
    it('passes when velocity and amount are within limits', async () => {
      mockIncrementTally.mockResolvedValue(tallyResult(1));
      await expect(
        fraudService.checkPrePayment({ accountId: ACC, amountWei: '5000000' }),
      ).resolves.not.toThrow();
    });

    it('throws FraudDetectedError on high per-minute velocity', async () => {
      mockIncrementTally
        .mockResolvedValueOnce(tallyResult(6)) // minute tally > 5
        .mockResolvedValueOnce(tallyResult(6)); // hour tally
      await expect(
        fraudService.checkPrePayment({ accountId: ACC, amountWei: '5000000' }),
      ).rejects.toThrow(FraudDetectedError);
    });

    it('throws FraudDetectedError on high per-hour velocity', async () => {
      mockIncrementTally
        .mockResolvedValueOnce(tallyResult(3)) // minute OK
        .mockResolvedValueOnce(tallyResult(61)); // hour > 60
      await expect(
        fraudService.checkPrePayment({ accountId: ACC, amountWei: '5000000' }),
      ).rejects.toThrow(FraudDetectedError);
    });

    it('records fraud event on velocity breach', async () => {
      mockIncrementTally
        .mockResolvedValueOnce(tallyResult(6))
        .mockResolvedValueOnce(tallyResult(6));
      try {
        await fraudService.checkPrePayment({ accountId: ACC, amountWei: '5000000' });
      } catch {
        /* expected */
      }
      expect(mockRecordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: ACC,
          eventType: 'high_velocity',
          severity: 'high',
        }),
      );
    });

    it('throws FraudDetectedError on amount below minimum', async () => {
      mockIncrementTally.mockResolvedValue(tallyResult(1));
      await expect(
        fraudService.checkPrePayment({ accountId: ACC, amountWei: '500' }),
      ).rejects.toThrow(FraudDetectedError);
    });

    it('throws FraudDetectedError on amount above maximum', async () => {
      mockIncrementTally.mockResolvedValue(tallyResult(1));
      await expect(
        fraudService.checkPrePayment({
          accountId: ACC,
          amountWei: '999999999999999999999',
        }),
      ).rejects.toThrow(FraudDetectedError);
    });

    it('uses per-route fraud rule overrides', async () => {
      mockIncrementTally.mockResolvedValue(tallyResult(1));
      await expect(
        fraudService.checkPrePayment({
          accountId: ACC,
          amountWei: '5000000',
          fraudRules: { maxAmountWei: '1000000' },
        }),
      ).rejects.toThrow(FraudDetectedError);
    });

    it('error details include rule and limits', async () => {
      mockIncrementTally.mockResolvedValue(tallyResult(1));
      try {
        await fraudService.checkPrePayment({ accountId: ACC, amountWei: '500' });
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(FraudDetectedError);
        expect(e.details.rule).toBe('abnormal_amount');
        expect(e.details.amountWei).toBe('500');
      }
    });
  });

  describe('checkVelocity', () => {
    it('increments both minute and hour tallies', async () => {
      mockIncrementTally.mockResolvedValue(tallyResult(1));
      await fraudService.checkVelocity(ACC, {
        maxPaymentsPerMinute: 5,
        maxPaymentsPerHour: 60,
      });
      expect(mockIncrementTally).toHaveBeenCalledTimes(2);
      const calls = mockIncrementTally.mock.calls;
      expect(calls[0][1]).toMatch(/^velocity:/);
      expect(calls[1][1]).toMatch(/^velocity-h:/);
    });

    it('does not throw when under both limits', async () => {
      mockIncrementTally.mockResolvedValue(tallyResult(3));
      await expect(
        fraudService.checkVelocity(ACC, {
          maxPaymentsPerMinute: 5,
          maxPaymentsPerHour: 60,
        }),
      ).resolves.not.toThrow();
    });

    it('hour breach records medium severity event', async () => {
      mockIncrementTally
        .mockResolvedValueOnce(tallyResult(3))
        .mockResolvedValueOnce(tallyResult(61));
      try {
        await fraudService.checkVelocity(ACC, {
          maxPaymentsPerMinute: 5,
          maxPaymentsPerHour: 60,
        });
      } catch {
        /* expected */
      }
      expect(mockRecordEvent).toHaveBeenCalledWith(expect.objectContaining({ severity: 'medium' }));
    });
  });

  describe('checkAmount', () => {
    it('does not throw for amount within bounds', async () => {
      await expect(
        fraudService.checkAmount('5000000', {
          minAmountWei: '1000',
          maxAmountWei: '100000000000000000000',
        }),
      ).resolves.not.toThrow();
    });

    it('throws for zero amount', async () => {
      await expect(
        fraudService.checkAmount('0', {
          minAmountWei: '1000',
          maxAmountWei: '100000000000000000000',
        }),
      ).rejects.toThrow(FraudDetectedError);
    });

    it('throws for amount exactly at max boundary + 1', async () => {
      await expect(
        fraudService.checkAmount('1001', {
          minAmountWei: '1000',
          maxAmountWei: '1000',
        }),
      ).rejects.toThrow(FraudDetectedError);
    });

    it('allows amount exactly at boundaries', async () => {
      await expect(
        fraudService.checkAmount('1000', {
          minAmountWei: '1000',
          maxAmountWei: '1000',
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('trackNonceFailure', () => {
    it('increments nonce failure tally', async () => {
      mockIncrementTally.mockResolvedValue(tallyResult(1));
      await fraudService.trackNonceFailure(ACC);
      expect(mockIncrementTally).toHaveBeenCalledOnce();
      expect(mockIncrementTally.mock.calls[0][1]).toMatch(/^nonce-fail:/);
    });

    it('does not throw when under threshold', async () => {
      mockIncrementTally.mockResolvedValue(tallyResult(2));
      await expect(fraudService.trackNonceFailure(ACC)).resolves.not.toThrow();
    });

    it('throws FraudDetectedError when threshold exceeded', async () => {
      mockIncrementTally.mockResolvedValue(tallyResult(4));
      await expect(fraudService.trackNonceFailure(ACC)).rejects.toThrow(FraudDetectedError);
    });

    it('records fraud event on nonce failure threshold breach', async () => {
      mockIncrementTally.mockResolvedValue(tallyResult(4));
      try {
        await fraudService.trackNonceFailure(ACC);
      } catch {
        /* expected */
      }
      expect(mockRecordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'repeated_nonce_failure',
          severity: 'high',
        }),
      );
    });

    it('uses per-route maxNonceFailuresPerMinute override', async () => {
      mockIncrementTally.mockResolvedValue(tallyResult(2));
      await expect(
        fraudService.trackNonceFailure(ACC, { maxNonceFailuresPerMinute: 1 }),
      ).rejects.toThrow(FraudDetectedError);
    });

    it('error details include rule and window', async () => {
      mockIncrementTally.mockResolvedValue(tallyResult(4));
      try {
        await fraudService.trackNonceFailure(ACC);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(FraudDetectedError);
        expect(e.details.rule).toBe('repeated_nonce_failure');
        expect(e.details.window).toBe('1m');
      }
    });
  });
});

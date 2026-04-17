import { describe, it, expect } from 'vitest';
import {
  TransferEvent,
  VerifyPaymentInput,
  VerifyPaymentResult,
} from '../../src/adapters/base/schemas.js';

describe('base/schemas', () => {
  describe('TransferEvent', () => {
    it('parses valid transfer event', () => {
      const result = TransferEvent.parse({
        from: '0x' + 'a'.repeat(40),
        to: '0x' + 'b'.repeat(40),
        amount: 1000n,
      });
      expect(result.from).toBe('0x' + 'a'.repeat(40));
      expect(result.to).toBe('0x' + 'b'.repeat(40));
      expect(result.amount).toBe(1000n);
    });

    it('lowercases addresses', () => {
      const result = TransferEvent.parse({
        from: '0x' + 'A'.repeat(40),
        to: '0x' + 'B'.repeat(40),
        amount: 0n,
      });
      expect(result.from).toBe('0x' + 'a'.repeat(40));
      expect(result.to).toBe('0x' + 'b'.repeat(40));
    });

    it('rejects non-hex address', () => {
      expect(() =>
        TransferEvent.parse({ from: 'notanaddr', to: '0x' + 'b'.repeat(40), amount: 0n }),
      ).toThrow();
    });

    it('rejects short address', () => {
      expect(() =>
        TransferEvent.parse({ from: '0x' + 'a'.repeat(39), to: '0x' + 'b'.repeat(40), amount: 0n }),
      ).toThrow();
    });

    it('rejects negative amount', () => {
      expect(() =>
        TransferEvent.parse({
          from: '0x' + 'a'.repeat(40),
          to: '0x' + 'b'.repeat(40),
          amount: -1n,
        }),
      ).toThrow();
    });

    it('accepts zero amount', () => {
      const result = TransferEvent.parse({
        from: '0x' + 'a'.repeat(40),
        to: '0x' + 'b'.repeat(40),
        amount: 0n,
      });
      expect(result.amount).toBe(0n);
    });
  });

  describe('VerifyPaymentInput', () => {
    const valid = {
      txHash: '0x' + 'a'.repeat(64),
      expectedTo: '0x' + 'b'.repeat(40),
      expectedAmountWei: 500n,
      minConfirmations: 2,
    };

    it('parses valid input', () => {
      const result = VerifyPaymentInput.parse(valid);
      expect(result.txHash).toBe('0x' + 'a'.repeat(64));
      expect(result.minConfirmations).toBe(2);
    });

    it('lowercases expectedTo', () => {
      const result = VerifyPaymentInput.parse({ ...valid, expectedTo: '0x' + 'B'.repeat(40) });
      expect(result.expectedTo).toBe('0x' + 'b'.repeat(40));
    });

    it('rejects short txHash', () => {
      expect(() => VerifyPaymentInput.parse({ ...valid, txHash: '0x' + 'a'.repeat(63) })).toThrow();
    });

    it('rejects non-hex txHash', () => {
      expect(() => VerifyPaymentInput.parse({ ...valid, txHash: '0x' + 'z'.repeat(64) })).toThrow();
    });

    it('rejects minConfirmations < 1', () => {
      expect(() => VerifyPaymentInput.parse({ ...valid, minConfirmations: 0 })).toThrow();
    });

    it('rejects non-integer minConfirmations', () => {
      expect(() => VerifyPaymentInput.parse({ ...valid, minConfirmations: 1.5 })).toThrow();
    });

    it('rejects negative expectedAmountWei', () => {
      expect(() => VerifyPaymentInput.parse({ ...valid, expectedAmountWei: -1n })).toThrow();
    });
  });

  describe('VerifyPaymentResult', () => {
    it('parses success result with blockNumber', () => {
      const result = VerifyPaymentResult.parse({ ok: true, blockNumber: 42 });
      expect(result).toEqual({ ok: true, blockNumber: 42 });
    });

    it('parses success result without blockNumber', () => {
      const result = VerifyPaymentResult.parse({ ok: true });
      expect(result).toEqual({ ok: true });
    });

    it('parses failure result', () => {
      const result = VerifyPaymentResult.parse({ ok: false, reason: 'tx-reverted' });
      expect(result).toEqual({ ok: false, reason: 'tx-reverted' });
    });

    it('rejects failure without reason', () => {
      expect(() => VerifyPaymentResult.parse({ ok: false })).toThrow();
    });

    it('rejects failure with empty reason', () => {
      expect(() => VerifyPaymentResult.parse({ ok: false, reason: '' })).toThrow();
    });

    it('rejects non-integer blockNumber', () => {
      expect(() => VerifyPaymentResult.parse({ ok: true, blockNumber: 1.5 })).toThrow();
    });
  });
});

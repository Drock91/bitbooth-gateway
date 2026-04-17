import { describe, it, expect } from 'vitest';
import {
  XrplAddress,
  XrplTxHash,
  IouAmount,
  DropsAmount,
  DeliveredAmount,
  XrplVerifyPaymentInput,
} from '../../src/validators/xrpl-payment.schema.js';

describe('xrpl-payment.schema', () => {
  describe('XrplAddress', () => {
    it('accepts valid classic address', () => {
      expect(XrplAddress.safeParse('rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh').success).toBe(true);
    });

    it('accepts another valid address', () => {
      expect(XrplAddress.safeParse('rN7n3473SaZBCG4dFL83w7p1W6G3nUqUKr').success).toBe(true);
    });

    it('rejects address not starting with r', () => {
      expect(XrplAddress.safeParse('xHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh').success).toBe(false);
    });

    it('rejects too-short address', () => {
      expect(XrplAddress.safeParse('rHb9CJAWyB4').success).toBe(false);
    });

    it('rejects empty string', () => {
      expect(XrplAddress.safeParse('').success).toBe(false);
    });

    it('rejects address with invalid base58 chars (0, O, I, l)', () => {
      expect(XrplAddress.safeParse('r0OIlCJAWyB4rj91VRWn96DkukG4bwdt').success).toBe(false);
    });
  });

  describe('XrplTxHash', () => {
    it('accepts 64-char hex uppercase', () => {
      expect(XrplTxHash.safeParse('A'.repeat(64)).success).toBe(true);
    });

    it('accepts 64-char hex lowercase', () => {
      expect(XrplTxHash.safeParse('a'.repeat(64)).success).toBe(true);
    });

    it('accepts mixed case hex', () => {
      expect(XrplTxHash.safeParse('AbCdEf0123456789'.repeat(4)).success).toBe(true);
    });

    it('rejects 63-char hash', () => {
      expect(XrplTxHash.safeParse('A'.repeat(63)).success).toBe(false);
    });

    it('rejects 65-char hash', () => {
      expect(XrplTxHash.safeParse('A'.repeat(65)).success).toBe(false);
    });

    it('rejects non-hex characters', () => {
      expect(XrplTxHash.safeParse('G'.repeat(64)).success).toBe(false);
    });
  });

  describe('DropsAmount', () => {
    it('accepts "1000000"', () => {
      expect(DropsAmount.safeParse('1000000').success).toBe(true);
    });

    it('accepts "0"', () => {
      expect(DropsAmount.safeParse('0').success).toBe(true);
    });

    it('rejects negative amounts', () => {
      expect(DropsAmount.safeParse('-100').success).toBe(false);
    });

    it('rejects decimal amounts', () => {
      expect(DropsAmount.safeParse('1.5').success).toBe(false);
    });

    it('rejects empty string', () => {
      expect(DropsAmount.safeParse('').success).toBe(false);
    });
  });

  describe('IouAmount', () => {
    const valid = {
      currency: 'USD',
      issuer: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B',
      value: '0.005',
    };

    it('accepts valid IOU', () => {
      expect(IouAmount.safeParse(valid).success).toBe(true);
    });

    it('accepts negative value (for clawbacks)', () => {
      expect(IouAmount.safeParse({ ...valid, value: '-1.5' }).success).toBe(true);
    });

    it('accepts integer value', () => {
      expect(IouAmount.safeParse({ ...valid, value: '100' }).success).toBe(true);
    });

    it('rejects missing currency', () => {
      const { currency: _currency, ...rest } = valid;
      expect(IouAmount.safeParse(rest).success).toBe(false);
    });

    it('rejects currency shorter than 3 chars', () => {
      expect(IouAmount.safeParse({ ...valid, currency: 'US' }).success).toBe(false);
    });

    it('rejects invalid issuer address', () => {
      expect(IouAmount.safeParse({ ...valid, issuer: 'invalid' }).success).toBe(false);
    });

    it('rejects non-numeric value', () => {
      expect(IouAmount.safeParse({ ...valid, value: 'abc' }).success).toBe(false);
    });
  });

  describe('DeliveredAmount', () => {
    it('accepts drops string', () => {
      expect(DeliveredAmount.safeParse('1000000').success).toBe(true);
    });

    it('accepts IOU object', () => {
      const iou = {
        currency: 'USD',
        issuer: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B',
        value: '0.005',
      };
      expect(DeliveredAmount.safeParse(iou).success).toBe(true);
    });

    it('rejects number type', () => {
      expect(DeliveredAmount.safeParse(1000000).success).toBe(false);
    });

    it('rejects null', () => {
      expect(DeliveredAmount.safeParse(null).success).toBe(false);
    });
  });

  describe('XrplVerifyPaymentInput', () => {
    const valid = {
      txHash: 'A'.repeat(64),
      destination: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
      amount: '1000000',
    };

    it('accepts valid XRP input', () => {
      expect(XrplVerifyPaymentInput.safeParse(valid).success).toBe(true);
    });

    it('accepts valid IOU input with issuer', () => {
      const iouInput = {
        txHash: 'B'.repeat(64),
        destination: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
        amount: {
          currency: 'USD',
          issuer: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B',
          value: '0.005',
        },
        issuer: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B',
      };
      expect(XrplVerifyPaymentInput.safeParse(iouInput).success).toBe(true);
    });

    it('issuer is optional', () => {
      expect(XrplVerifyPaymentInput.safeParse(valid).data.issuer).toBeUndefined();
    });

    it('rejects invalid txHash', () => {
      expect(XrplVerifyPaymentInput.safeParse({ ...valid, txHash: 'short' }).success).toBe(false);
    });

    it('rejects invalid destination', () => {
      expect(
        XrplVerifyPaymentInput.safeParse({ ...valid, destination: 'not-an-address' }).success,
      ).toBe(false);
    });

    it('rejects missing amount', () => {
      const { amount: _amount, ...rest } = valid;
      expect(XrplVerifyPaymentInput.safeParse(rest).success).toBe(false);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEnforceX402, mockListByAccount } = vi.hoisted(() => ({
  mockEnforceX402: vi.fn(),
  mockListByAccount: vi.fn(),
}));

vi.mock('../../src/middleware/x402.middleware.js', () => ({
  enforceX402: mockEnforceX402,
}));
vi.mock('../../src/repositories/payments.repo.js', () => ({
  paymentsRepo: { listByAccount: mockListByAccount },
}));

import { paymentsService } from '../../src/services/payments.service.js';

describe('paymentsService', () => {
  beforeEach(() => {
    mockEnforceX402.mockReset();
    mockListByAccount.mockReset();
  });

  describe('requirePayment', () => {
    it('delegates to enforceX402 with the input object', async () => {
      const input = { route: { amountWei: '1000' }, headers: {}, accountId: 'acc-1' };
      mockEnforceX402.mockResolvedValueOnce({ txHash: '0xabc' });

      await paymentsService.requirePayment(input);

      expect(mockEnforceX402).toHaveBeenCalledWith(input);
      expect(mockEnforceX402).toHaveBeenCalledOnce();
    });

    it('returns the result from enforceX402', async () => {
      const expected = { txHash: '0xdef', blockNumber: 42 };
      mockEnforceX402.mockResolvedValueOnce(expected);

      const result = await paymentsService.requirePayment({ route: {} });

      expect(result).toEqual(expected);
    });

    it('propagates PaymentRequiredError from enforceX402', async () => {
      const err = new Error('Payment required');
      err.name = 'PaymentRequiredError';
      err.status = 402;
      mockEnforceX402.mockRejectedValueOnce(err);

      await expect(paymentsService.requirePayment({ route: {} })).rejects.toThrow(
        'Payment required',
      );
    });

    it('propagates validation errors from enforceX402', async () => {
      mockEnforceX402.mockRejectedValueOnce(new Error('invalid nonce'));

      await expect(paymentsService.requirePayment({ route: {} })).rejects.toThrow('invalid nonce');
    });

    it('passes through undefined return when enforceX402 returns undefined', async () => {
      mockEnforceX402.mockResolvedValueOnce(undefined);

      const result = await paymentsService.requirePayment({ route: {} });

      expect(result).toBeUndefined();
    });
  });

  describe('listPayments', () => {
    it('returns payments and nextCursor when lastKey exists', async () => {
      const items = [{ idempotencyKey: 'n1' }, { idempotencyKey: 'n2' }];
      const lastKey = { idempotencyKey: 'n2', accountId: 'acc-1' };
      mockListByAccount.mockResolvedValueOnce({ items, lastKey });

      const result = await paymentsService.listPayments('acc-1', { limit: 10 });

      expect(result.payments).toEqual(items);
      expect(result.nextCursor).toBeTruthy();
      expect(mockListByAccount).toHaveBeenCalledWith('acc-1', 10, undefined);
    });

    it('returns null nextCursor when no more pages', async () => {
      mockListByAccount.mockResolvedValueOnce({ items: [{ idempotencyKey: 'n1' }], lastKey: null });

      const result = await paymentsService.listPayments('acc-1');

      expect(result.payments).toHaveLength(1);
      expect(result.nextCursor).toBeNull();
    });

    it('decodes cursor and passes as ExclusiveStartKey', async () => {
      const startKey = { idempotencyKey: 'n5', accountId: 'acc-1' };
      const cursor = Buffer.from(JSON.stringify(startKey)).toString('base64url');
      mockListByAccount.mockResolvedValueOnce({ items: [], lastKey: null });

      await paymentsService.listPayments('acc-1', { limit: 5, cursor });

      expect(mockListByAccount).toHaveBeenCalledWith('acc-1', 5, startKey);
    });

    it('uses default limit of 20 when not specified', async () => {
      mockListByAccount.mockResolvedValueOnce({ items: [], lastKey: null });

      await paymentsService.listPayments('acc-1');

      expect(mockListByAccount).toHaveBeenCalledWith('acc-1', 20, undefined);
    });

    it('roundtrips cursor encoding correctly', async () => {
      const lastKey = { idempotencyKey: 'abc', accountId: 'x' };
      mockListByAccount.mockResolvedValueOnce({ items: [], lastKey });

      const first = await paymentsService.listPayments('x');

      mockListByAccount.mockResolvedValueOnce({ items: [], lastKey: null });
      await paymentsService.listPayments('x', { cursor: first.nextCursor });

      expect(mockListByAccount.mock.calls[1][2]).toEqual(lastKey);
    });

    it('propagates repo errors', async () => {
      mockListByAccount.mockRejectedValueOnce(new Error('DDB down'));

      await expect(paymentsService.listPayments('acc-1')).rejects.toThrow('DDB down');
    });

    it('handles empty options object', async () => {
      mockListByAccount.mockResolvedValueOnce({ items: [], lastKey: null });

      const result = await paymentsService.listPayments('acc-1', {});

      expect(result.payments).toEqual([]);
      expect(mockListByAccount).toHaveBeenCalledWith('acc-1', 20, undefined);
    });
  });
});

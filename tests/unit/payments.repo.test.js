import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {},
}));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
  GetCommand: vi.fn(function (p) {
    Object.assign(this, { _type: 'Get', ...p });
  }),
  PutCommand: vi.fn(function (p) {
    Object.assign(this, { _type: 'Put', ...p });
  }),
  QueryCommand: vi.fn(function (p) {
    Object.assign(this, { _type: 'Query', ...p });
  }),
  ScanCommand: vi.fn(function (p) {
    Object.assign(this, { _type: 'Scan', ...p });
  }),
}));
vi.mock('../../src/lib/config.js', () => ({
  getConfig: () => ({ awsRegion: 'us-east-1' }),
}));

import { paymentsRepo } from '../../src/repositories/payments.repo.js';

describe('paymentsRepo', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  describe('getByNonce', () => {
    it('returns item when found', async () => {
      const item = { idempotencyKey: 'n1', status: 'confirmed' };
      mockSend.mockResolvedValueOnce({ Item: item });
      const result = await paymentsRepo.getByNonce('n1');
      expect(result).toEqual(item);
    });

    it('returns undefined when not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      const result = await paymentsRepo.getByNonce('missing');
      expect(result).toBeUndefined();
    });
  });

  describe('recordConfirmed', () => {
    it('puts item successfully', async () => {
      mockSend.mockResolvedValueOnce({});
      await paymentsRepo.recordConfirmed({
        idempotencyKey: 'n1',
        accountId: 'acc-1',
        amountWei: '100',
        assetSymbol: 'USDC',
        txHash: '0xabc',
        blockNumber: 42,
      });
      expect(mockSend).toHaveBeenCalledOnce();
    });

    it('throws ConflictError on duplicate nonce', async () => {
      const err = new Error('conditional');
      err.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(err);
      await expect(
        paymentsRepo.recordConfirmed({
          idempotencyKey: 'n1',
          accountId: 'acc-1',
          amountWei: '100',
          assetSymbol: 'USDC',
          txHash: '0xabc',
          blockNumber: 42,
        }),
      ).rejects.toThrow('nonce already used');
    });

    it('re-throws unexpected errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('network'));
      await expect(
        paymentsRepo.recordConfirmed({
          idempotencyKey: 'n1',
          accountId: 'acc-1',
          amountWei: '100',
          assetSymbol: 'USDC',
          txHash: '0xabc',
          blockNumber: 42,
        }),
      ).rejects.toThrow('network');
    });
  });

  describe('listByAccount', () => {
    it('returns items and lastKey from GSI query', async () => {
      const items = [
        { idempotencyKey: 'n1', accountId: 'acc-1', status: 'confirmed' },
        { idempotencyKey: 'n2', accountId: 'acc-1', status: 'confirmed' },
      ];
      mockSend.mockResolvedValueOnce({ Items: items, LastEvaluatedKey: { idempotencyKey: 'n2' } });
      const result = await paymentsRepo.listByAccount('acc-1');
      expect(result.items).toEqual(items);
      expect(result.lastKey).toEqual({ idempotencyKey: 'n2' });
    });

    it('returns empty items when no items', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      const result = await paymentsRepo.listByAccount('acc-2');
      expect(result.items).toEqual([]);
      expect(result.lastKey).toBeNull();
    });

    it('returns empty items when Items is undefined', async () => {
      mockSend.mockResolvedValueOnce({});
      const result = await paymentsRepo.listByAccount('acc-3');
      expect(result.items).toEqual([]);
      expect(result.lastKey).toBeNull();
    });

    it('respects custom limit', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await paymentsRepo.listByAccount('acc-1', 5);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.Limit).toBe(5);
    });

    it('uses default limit of 20', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await paymentsRepo.listByAccount('acc-1');
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.Limit).toBe(20);
    });

    it('queries gsi-accountId index in descending order', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await paymentsRepo.listByAccount('acc-1');
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.IndexName).toBe('gsi-accountId');
      expect(cmd.ScanIndexForward).toBe(false);
    });

    it('passes accountId in KeyConditionExpression', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await paymentsRepo.listByAccount('acc-99');
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.KeyConditionExpression).toBe('accountId = :a');
      expect(cmd.ExpressionAttributeValues[':a']).toBe('acc-99');
    });

    it('passes cursor as ExclusiveStartKey', async () => {
      const cursor = { idempotencyKey: 'n5', accountId: 'acc-1' };
      mockSend.mockResolvedValueOnce({ Items: [] });
      await paymentsRepo.listByAccount('acc-1', 10, cursor);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.ExclusiveStartKey).toEqual(cursor);
    });

    it('omits ExclusiveStartKey when cursor is undefined', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await paymentsRepo.listByAccount('acc-1', 10);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.ExclusiveStartKey).toBeUndefined();
    });

    it('returns null lastKey when no LastEvaluatedKey', async () => {
      mockSend.mockResolvedValueOnce({ Items: [{ idempotencyKey: 'n1' }] });
      const result = await paymentsRepo.listByAccount('acc-1');
      expect(result.lastKey).toBeNull();
    });
  });

  describe('getByNonce — param verification', () => {
    it('sends GetCommand with idempotencyKey as key', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      await paymentsRepo.getByNonce('nonce-xyz');
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.Key).toEqual({ idempotencyKey: 'nonce-xyz' });
    });

    it('uses correct table name', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      await paymentsRepo.getByNonce('n1');
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.TableName).toBe('x402-payments');
    });
  });

  describe('recordConfirmed — item fields', () => {
    it('sets status to confirmed with timestamps', async () => {
      mockSend.mockResolvedValueOnce({});
      await paymentsRepo.recordConfirmed({
        idempotencyKey: 'n1',
        accountId: 'acc-1',
        amountWei: '500',
        assetSymbol: 'USDC',
        txHash: '0xdef',
        blockNumber: 100,
      });
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.Item.status).toBe('confirmed');
      expect(cmd.Item.createdAt).toBeDefined();
      expect(cmd.Item.confirmedAt).toBeDefined();
      expect(cmd.Item.amountWei).toBe('500');
      expect(cmd.Item.txHash).toBe('0xdef');
      expect(cmd.Item.blockNumber).toBe(100);
    });

    it('uses ConditionExpression to prevent duplicates', async () => {
      mockSend.mockResolvedValueOnce({});
      await paymentsRepo.recordConfirmed({
        idempotencyKey: 'n1',
        accountId: 'acc-1',
        amountWei: '100',
        assetSymbol: 'USDC',
        txHash: '0xabc',
        blockNumber: 42,
      });
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.ConditionExpression).toBe('attribute_not_exists(idempotencyKey)');
    });

    it('ConflictError has status 409', async () => {
      const err = new Error('conditional');
      err.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(err);
      try {
        await paymentsRepo.recordConfirmed({
          idempotencyKey: 'n1',
          accountId: 'acc-1',
          amountWei: '100',
          assetSymbol: 'USDC',
          txHash: '0xabc',
          blockNumber: 42,
        });
      } catch (e) {
        expect(e.name).toBe('ConflictError');
        expect(e.status).toBe(409);
        return;
      }
      throw new Error('expected error');
    });
  });

  describe('getByNonce — error handling', () => {
    it('propagates DDB network errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('DDB timeout'));
      await expect(paymentsRepo.getByNonce('n1')).rejects.toThrow('DDB timeout');
    });

    it('propagates DDB throttling errors', async () => {
      const err = new Error('throttled');
      err.name = 'ProvisionedThroughputExceededException';
      mockSend.mockRejectedValueOnce(err);
      await expect(paymentsRepo.getByNonce('n1')).rejects.toThrow('throttled');
    });
  });

  describe('recordConfirmed — timestamp format', () => {
    it('createdAt and confirmedAt are valid ISO 8601 strings', async () => {
      mockSend.mockResolvedValueOnce({});
      await paymentsRepo.recordConfirmed({
        idempotencyKey: 'ts-1',
        accountId: 'acc-1',
        amountWei: '100',
        assetSymbol: 'USDC',
        txHash: '0xabc',
        blockNumber: 1,
      });
      const item = mockSend.mock.calls[0][0].Item;
      expect(new Date(item.createdAt).toISOString()).toBe(item.createdAt);
      expect(new Date(item.confirmedAt).toISOString()).toBe(item.confirmedAt);
    });

    it('stores resource field when provided', async () => {
      mockSend.mockResolvedValueOnce({});
      await paymentsRepo.recordConfirmed({
        idempotencyKey: 'r1',
        accountId: 'acc-1',
        amountWei: '5000',
        assetSymbol: 'USDC',
        txHash: '0xfetch',
        blockNumber: 50,
        resource: '/v1/fetch',
      });
      const item = mockSend.mock.calls[0][0].Item;
      expect(item.resource).toBe('/v1/fetch');
    });

    it('omits resource field when not provided', async () => {
      mockSend.mockResolvedValueOnce({});
      await paymentsRepo.recordConfirmed({
        idempotencyKey: 'r2',
        accountId: 'acc-1',
        amountWei: '10000',
        assetSymbol: 'USDC',
        txHash: '0xres',
        blockNumber: 51,
      });
      const item = mockSend.mock.calls[0][0].Item;
      expect(item.resource).toBeUndefined();
    });

    it('preserves all input fields on the stored item', async () => {
      mockSend.mockResolvedValueOnce({});
      await paymentsRepo.recordConfirmed({
        idempotencyKey: 'k1',
        accountId: 'acc-2',
        amountWei: '999',
        assetSymbol: 'ETH',
        txHash: '0xfff',
        blockNumber: 77,
      });
      const item = mockSend.mock.calls[0][0].Item;
      expect(item.idempotencyKey).toBe('k1');
      expect(item.accountId).toBe('acc-2');
      expect(item.amountWei).toBe('999');
      expect(item.assetSymbol).toBe('ETH');
      expect(item.txHash).toBe('0xfff');
      expect(item.blockNumber).toBe(77);
    });
  });

  describe('recordConfirmed — error edge cases', () => {
    it('does not wrap error when name is null', async () => {
      const err = new Error('weird');
      err.name = null;
      mockSend.mockRejectedValueOnce(err);
      await expect(
        paymentsRepo.recordConfirmed({
          idempotencyKey: 'n1',
          accountId: 'acc-1',
          amountWei: '100',
          assetSymbol: 'USDC',
          txHash: '0xabc',
          blockNumber: 1,
        }),
      ).rejects.toThrow('weird');
    });

    it('does not wrap error when name is undefined', async () => {
      const err = new Error('no name');
      delete err.name;
      mockSend.mockRejectedValueOnce(err);
      await expect(
        paymentsRepo.recordConfirmed({
          idempotencyKey: 'n1',
          accountId: 'acc-1',
          amountWei: '100',
          assetSymbol: 'USDC',
          txHash: '0xabc',
          blockNumber: 1,
        }),
      ).rejects.toThrow('no name');
    });
  });

  describe('listByAccount — error handling', () => {
    it('propagates DDB query errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('query failed'));
      await expect(paymentsRepo.listByAccount('acc-1')).rejects.toThrow('query failed');
    });
  });

  describe('scanAllConfirmed', () => {
    it('returns items from a single-page scan', async () => {
      const items = [{ idempotencyKey: 'n1', status: 'confirmed' }];
      mockSend.mockResolvedValueOnce({ Items: items });
      const result = await paymentsRepo.scanAllConfirmed();
      expect(result).toEqual(items);
      expect(mockSend).toHaveBeenCalledOnce();
    });

    it('sends a ScanCommand against the payments table', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await paymentsRepo.scanAllConfirmed();
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._type).toBe('Scan');
      expect(cmd.TableName).toBe('x402-payments');
    });

    it('filters to confirmed status only', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await paymentsRepo.scanAllConfirmed();
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.FilterExpression).toBe('#s = :confirmed');
      expect(cmd.ExpressionAttributeNames).toEqual({ '#s': 'status' });
      expect(cmd.ExpressionAttributeValues).toEqual({ ':confirmed': 'confirmed' });
    });

    it('does not include ExclusiveStartKey on first page', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await paymentsRepo.scanAllConfirmed();
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.ExclusiveStartKey).toBeUndefined();
    });

    it('follows LastEvaluatedKey across multiple pages', async () => {
      const page1 = [{ idempotencyKey: 'n1', status: 'confirmed' }];
      const page2 = [{ idempotencyKey: 'n2', status: 'confirmed' }];
      const page3 = [{ idempotencyKey: 'n3', status: 'confirmed' }];
      mockSend
        .mockResolvedValueOnce({ Items: page1, LastEvaluatedKey: { idempotencyKey: 'n1' } })
        .mockResolvedValueOnce({ Items: page2, LastEvaluatedKey: { idempotencyKey: 'n2' } })
        .mockResolvedValueOnce({ Items: page3 });

      const result = await paymentsRepo.scanAllConfirmed();

      expect(result).toEqual([...page1, ...page2, ...page3]);
      expect(mockSend).toHaveBeenCalledTimes(3);
      expect(mockSend.mock.calls[1][0].ExclusiveStartKey).toEqual({ idempotencyKey: 'n1' });
      expect(mockSend.mock.calls[2][0].ExclusiveStartKey).toEqual({ idempotencyKey: 'n2' });
    });

    it('returns empty array when Items is undefined on every page', async () => {
      mockSend.mockResolvedValueOnce({ Items: undefined });
      const result = await paymentsRepo.scanAllConfirmed();
      expect(result).toEqual([]);
    });

    it('handles empty-items pages mixed with populated pages', async () => {
      mockSend
        .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { idempotencyKey: 'start' } })
        .mockResolvedValueOnce({ Items: [{ idempotencyKey: 'n2', status: 'confirmed' }] });
      const result = await paymentsRepo.scanAllConfirmed();
      expect(result).toHaveLength(1);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('propagates DDB scan errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('scan error'));
      await expect(paymentsRepo.scanAllConfirmed()).rejects.toThrow('scan error');
    });
  });
});

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
  UpdateCommand: vi.fn(function (p) {
    Object.assign(this, { _type: 'Update', ...p });
  }),
  QueryCommand: vi.fn(function (p) {
    Object.assign(this, { _type: 'Query', ...p });
  }),
}));
vi.mock('../../src/lib/config.js', () => ({
  getConfig: () => ({ awsRegion: 'us-east-1' }),
}));

import { usageRepo } from '../../src/repositories/usage.repo.js';

describe('usageRepo', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  describe('increment', () => {
    it('sends UpdateCommand with atomic increment', async () => {
      mockSend.mockResolvedValueOnce({});
      await usageRepo.increment('acc-1', {
        resource: '/v1/quote',
        txHash: '0xabc',
      });
      expect(mockSend).toHaveBeenCalledOnce();
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._type).toBe('Update');
      expect(cmd.TableName).toBe('x402-usage');
      expect(cmd.Key.accountId).toBe('acc-1');
      expect(cmd.Key.yearMonth).toMatch(/^\d{4}-\d{2}$/);
    });

    it('uses if_not_exists for callCount initialisation', async () => {
      mockSend.mockResolvedValueOnce({});
      await usageRepo.increment('acc-1', {
        resource: '/v1/quote',
        txHash: '0xabc',
      });
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.UpdateExpression).toContain('if_not_exists(callCount, :zero)');
      expect(cmd.ExpressionAttributeValues[':zero']).toBe(0);
      expect(cmd.ExpressionAttributeValues[':one']).toBe(1);
    });

    it('adds resource and txHash to sets', async () => {
      mockSend.mockResolvedValueOnce({});
      await usageRepo.increment('acc-1', {
        resource: '/v1/resource',
        txHash: '0xdef',
      });
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.UpdateExpression).toContain('ADD resources :res, txHashes :tx');
      expect(cmd.ExpressionAttributeValues[':res']).toEqual(new Set(['/v1/resource']));
      expect(cmd.ExpressionAttributeValues[':tx']).toEqual(new Set(['0xdef']));
    });

    it('sets lastCallAt timestamp', async () => {
      mockSend.mockResolvedValueOnce({});
      await usageRepo.increment('acc-1', {
        resource: '/v1/quote',
        txHash: '0xabc',
      });
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.ExpressionAttributeValues[':now']).toBeDefined();
      expect(new Date(cmd.ExpressionAttributeValues[':now']).getTime()).not.toBeNaN();
    });

    it('propagates DDB errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('throttled'));
      await expect(
        usageRepo.increment('acc-1', { resource: '/v1/quote', txHash: '0x1' }),
      ).rejects.toThrow('throttled');
    });
  });

  describe('getForPeriod', () => {
    it('returns item when found', async () => {
      const item = { accountId: 'acc-1', yearMonth: '2026-04', callCount: 42 };
      mockSend.mockResolvedValueOnce({ Item: item });
      const result = await usageRepo.getForPeriod('acc-1', '2026-04');
      expect(result).toEqual(item);
    });

    it('returns default zero-count when not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      const result = await usageRepo.getForPeriod('acc-1', '2026-04');
      expect(result).toEqual({ accountId: 'acc-1', yearMonth: '2026-04', callCount: 0 });
    });

    it('sends GetCommand with correct key', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      await usageRepo.getForPeriod('acc-2', '2026-03');
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._type).toBe('Get');
      expect(cmd.TableName).toBe('x402-usage');
      expect(cmd.Key).toEqual({ accountId: 'acc-2', yearMonth: '2026-03' });
    });
  });

  describe('listByAccount', () => {
    it('returns items from query', async () => {
      const items = [
        { accountId: 'acc-1', yearMonth: '2026-04', callCount: 10 },
        { accountId: 'acc-1', yearMonth: '2026-03', callCount: 5 },
      ];
      mockSend.mockResolvedValueOnce({ Items: items });
      const result = await usageRepo.listByAccount('acc-1');
      expect(result).toEqual(items);
    });

    it('returns empty array when no items', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      const result = await usageRepo.listByAccount('acc-new');
      expect(result).toEqual([]);
    });

    it('returns empty array when Items is undefined', async () => {
      mockSend.mockResolvedValueOnce({});
      const result = await usageRepo.listByAccount('acc-new');
      expect(result).toEqual([]);
    });

    it('uses default limit of 12', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await usageRepo.listByAccount('acc-1');
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.Limit).toBe(12);
    });

    it('respects custom limit', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await usageRepo.listByAccount('acc-1', 3);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.Limit).toBe(3);
    });

    it('queries in descending order', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await usageRepo.listByAccount('acc-1');
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.ScanIndexForward).toBe(false);
    });

    it('uses accountId in KeyConditionExpression', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await usageRepo.listByAccount('acc-99');
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.KeyConditionExpression).toBe('accountId = :a');
      expect(cmd.ExpressionAttributeValues[':a']).toBe('acc-99');
    });
  });
});

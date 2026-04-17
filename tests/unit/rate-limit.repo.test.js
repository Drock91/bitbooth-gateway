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
  UpdateCommand: vi.fn(function (p) {
    Object.assign(this, { _type: 'Update', ...p });
  }),
}));
vi.mock('../../src/lib/config.js', () => ({
  getConfig: () => ({ awsRegion: 'us-east-1' }),
}));

import { rateLimitRepo } from '../../src/repositories/rate-limit.repo.js';

const ACC = '550e8400-e29b-41d4-a716-446655440000';

describe('rateLimitRepo', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  describe('getBucket', () => {
    it('returns null when no item exists', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      const result = await rateLimitRepo.getBucket(ACC);
      expect(result).toBeNull();
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._type).toBe('Get');
      expect(cmd.Key).toEqual({ accountId: ACC });
    });

    it('returns parsed bucket when item exists', async () => {
      const item = {
        accountId: ACC,
        tokens: 8,
        lastRefillAt: '2026-04-05T10:00:00.000Z',
        capacity: 10,
        refillRate: 0.1667,
      };
      mockSend.mockResolvedValueOnce({ Item: item });
      const result = await rateLimitRepo.getBucket(ACC);
      expect(result.accountId).toBe(ACC);
      expect(result.tokens).toBe(8);
    });

    it('uses correct table name from env default', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      await rateLimitRepo.getBucket(ACC);
      expect(mockSend.mock.calls[0][0].TableName).toBe('x402-rate-limits');
    });
  });

  describe('consume', () => {
    it('creates bucket on first request with capacity - 1 tokens', async () => {
      // getBucket returns null
      mockSend.mockResolvedValueOnce({ Item: undefined });
      // PutCommand succeeds
      mockSend.mockResolvedValueOnce({});

      const result = await rateLimitRepo.consume(ACC, 10, 0.1667);
      expect(result.tokens).toBe(9);
      expect(result.capacity).toBe(10);
      const putCmd = mockSend.mock.calls[1][0];
      expect(putCmd._type).toBe('Put');
      expect(putCmd.ConditionExpression).toBe('attribute_not_exists(accountId)');
    });

    it('refills tokens based on elapsed time and consumes one', async () => {
      const twoSecsAgo = new Date(Date.now() - 2000).toISOString();
      const bucket = {
        accountId: ACC,
        tokens: 5,
        lastRefillAt: twoSecsAgo,
        capacity: 10,
        refillRate: 1, // 1 token/sec => +2 tokens in 2s => 7 - 1 = 6
      };
      // getBucket
      mockSend.mockResolvedValueOnce({ Item: bucket });
      // UpdateCommand
      mockSend.mockResolvedValueOnce({});

      const result = await rateLimitRepo.consume(ACC, 10, 1);
      expect(result.tokens).toBeGreaterThanOrEqual(5.9);
      expect(result.tokens).toBeLessThanOrEqual(7);
      const updateCmd = mockSend.mock.calls[1][0];
      expect(updateCmd._type).toBe('Update');
      expect(updateCmd.ConditionExpression).toBe('lastRefillAt = :oldRefill');
    });

    it('returns null when no tokens available after refill', async () => {
      const justNow = new Date().toISOString();
      const bucket = {
        accountId: ACC,
        tokens: 0,
        lastRefillAt: justNow,
        capacity: 10,
        refillRate: 0.1667,
      };
      mockSend.mockResolvedValueOnce({ Item: bucket });

      const result = await rateLimitRepo.consume(ACC, 10, 0.1667);
      expect(result).toBeNull();
      // No update should be sent
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('caps refill at capacity', async () => {
      const longAgo = new Date(Date.now() - 600000).toISOString(); // 10 min ago
      const bucket = {
        accountId: ACC,
        tokens: 5,
        lastRefillAt: longAgo,
        capacity: 10,
        refillRate: 1,
      };
      mockSend.mockResolvedValueOnce({ Item: bucket });
      mockSend.mockResolvedValueOnce({});

      const result = await rateLimitRepo.consume(ACC, 10, 1);
      // Should be capped at 10 - 1 = 9
      expect(result.tokens).toBe(9);
    });

    it('uses optimistic concurrency on lastRefillAt', async () => {
      const ts = '2026-04-05T10:00:00.000Z';
      const bucket = {
        accountId: ACC,
        tokens: 5,
        lastRefillAt: ts,
        capacity: 10,
        refillRate: 1,
      };
      mockSend.mockResolvedValueOnce({ Item: bucket });
      mockSend.mockResolvedValueOnce({});

      await rateLimitRepo.consume(ACC, 10, 1);
      const updateCmd = mockSend.mock.calls[1][0];
      expect(updateCmd.ExpressionAttributeValues[':oldRefill']).toBe(ts);
    });

    it('propagates DDB errors', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockRejectedValueOnce(new Error('ServiceUnavailable'));
      await expect(rateLimitRepo.consume(ACC, 10, 1)).rejects.toThrow('ServiceUnavailable');
    });

    it('updates capacity and refillRate on existing bucket', async () => {
      const bucket = {
        accountId: ACC,
        tokens: 5,
        lastRefillAt: new Date(Date.now() - 1000).toISOString(),
        capacity: 10,
        refillRate: 1,
      };
      mockSend.mockResolvedValueOnce({ Item: bucket });
      mockSend.mockResolvedValueOnce({});

      const result = await rateLimitRepo.consume(ACC, 100, 2);
      expect(result.capacity).toBe(100);
      expect(result.refillRate).toBe(2);
    });
  });
});

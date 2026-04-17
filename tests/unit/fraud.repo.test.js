import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {},
}));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
  PutCommand: vi.fn(function (p) {
    Object.assign(this, { _type: 'Put', ...p });
  }),
  QueryCommand: vi.fn(function (p) {
    Object.assign(this, { _type: 'Query', ...p });
  }),
  ScanCommand: vi.fn(function (p) {
    Object.assign(this, { _type: 'Scan', ...p });
  }),
  UpdateCommand: vi.fn(function (p) {
    Object.assign(this, { _type: 'Update', ...p });
  }),
}));
vi.mock('../../src/lib/config.js', () => ({
  getConfig: () => ({ awsRegion: 'us-east-1' }),
}));

import { fraudRepo } from '../../src/repositories/fraud.repo.js';

const ACC = 'acct-fraud-1';

describe('fraudRepo', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  describe('recordEvent', () => {
    it('sends PutCommand to fraud events table', async () => {
      mockSend.mockResolvedValueOnce({});
      await fraudRepo.recordEvent({
        accountId: ACC,
        eventType: 'high_velocity',
        severity: 'high',
        details: { window: '1m', count: 6 },
      });
      expect(mockSend).toHaveBeenCalledOnce();
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._type).toBe('Put');
      expect(cmd.TableName).toBe('x402-fraud-events');
    });

    it('includes TTL for auto-expiry', async () => {
      mockSend.mockResolvedValueOnce({});
      const ev = await fraudRepo.recordEvent({
        accountId: ACC,
        eventType: 'high_velocity',
        severity: 'high',
        details: {},
      });
      expect(ev.ttl).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('returns parsed fraud event', async () => {
      mockSend.mockResolvedValueOnce({});
      const result = await fraudRepo.recordEvent({
        accountId: ACC,
        eventType: 'repeated_nonce_failure',
        severity: 'medium',
        details: { count: 4 },
      });
      expect(result.accountId).toBe(ACC);
      expect(result.eventType).toBe('repeated_nonce_failure');
      expect(result.severity).toBe('medium');
      expect(result.timestamp).toBeDefined();
    });

    it('propagates DDB errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('ServiceUnavailable'));
      await expect(
        fraudRepo.recordEvent({
          accountId: ACC,
          eventType: 'high_velocity',
          severity: 'low',
          details: {},
        }),
      ).rejects.toThrow('ServiceUnavailable');
    });
  });

  describe('listByAccount', () => {
    it('queries events in descending order', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await fraudRepo.listByAccount(ACC);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._type).toBe('Query');
      expect(cmd.TableName).toBe('x402-fraud-events');
      expect(cmd.ScanIndexForward).toBe(false);
    });

    it('returns parsed events', async () => {
      const items = [
        {
          accountId: ACC,
          timestamp: new Date().toISOString(),
          eventType: 'high_velocity',
          severity: 'high',
          details: {},
        },
      ];
      mockSend.mockResolvedValueOnce({ Items: items });
      const result = await fraudRepo.listByAccount(ACC);
      expect(result).toHaveLength(1);
      expect(result[0].eventType).toBe('high_velocity');
    });

    it('returns empty array when no items', async () => {
      mockSend.mockResolvedValueOnce({ Items: undefined });
      const result = await fraudRepo.listByAccount(ACC);
      expect(result).toEqual([]);
    });

    it('uses default limit of 20', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await fraudRepo.listByAccount(ACC);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.Limit).toBe(20);
    });

    it('respects custom limit', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await fraudRepo.listByAccount(ACC, 5);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.Limit).toBe(5);
    });
  });

  describe('incrementTally', () => {
    it('sends UpdateCommand with atomic increment', async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: {
          accountId: ACC,
          windowKey: 'velocity:2026-04-05T12:05',
          eventCount: 1,
          lastEventAt: new Date().toISOString(),
        },
      });
      await fraudRepo.incrementTally(ACC, 'velocity:2026-04-05T12:05');
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._type).toBe('Update');
      expect(cmd.TableName).toBe('x402-fraud-tally');
      expect(cmd.UpdateExpression).toContain('if_not_exists(eventCount, :zero) + :one');
      expect(cmd.ReturnValues).toBe('ALL_NEW');
    });

    it('returns parsed tally with new count', async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: {
          accountId: ACC,
          windowKey: 'velocity:2026-04-05T12:05',
          eventCount: 3,
          lastEventAt: new Date().toISOString(),
        },
      });
      const result = await fraudRepo.incrementTally(ACC, 'velocity:2026-04-05T12:05');
      expect(result.eventCount).toBe(3);
      expect(result.accountId).toBe(ACC);
    });

    it('sets TTL on tally items', async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: {
          accountId: ACC,
          windowKey: 'nonce-fail:2026-04-05T12:05',
          eventCount: 1,
          lastEventAt: new Date().toISOString(),
        },
      });
      await fraudRepo.incrementTally(ACC, 'nonce-fail:2026-04-05T12:05');
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.ExpressionAttributeNames['#ttl']).toBe('ttl');
      expect(cmd.ExpressionAttributeValues[':ttlVal']).toBeGreaterThan(
        Math.floor(Date.now() / 1000),
      );
    });

    it('propagates DDB errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('throttled'));
      await expect(fraudRepo.incrementTally(ACC, 'velocity:2026-04-05T12:05')).rejects.toThrow(
        'throttled',
      );
    });
  });

  describe('scanEventsSince', () => {
    const SINCE = '2026-04-01T00:00:00.000Z';

    it('returns items from a single-page scan', async () => {
      const items = [
        {
          accountId: ACC,
          timestamp: '2026-04-10T10:00:00.000Z',
          eventType: 'high_velocity',
          severity: 'high',
          details: {},
        },
      ];
      mockSend.mockResolvedValueOnce({ Items: items });
      const result = await fraudRepo.scanEventsSince(SINCE);
      expect(result).toEqual(items);
      expect(mockSend).toHaveBeenCalledOnce();
    });

    it('sends a ScanCommand against the events table', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await fraudRepo.scanEventsSince(SINCE);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._type).toBe('Scan');
      expect(cmd.TableName).toBe('x402-fraud-events');
    });

    it('passes filter expression for timestamp since', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await fraudRepo.scanEventsSince(SINCE);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.FilterExpression).toBe('#ts >= :since');
      expect(cmd.ExpressionAttributeNames).toEqual({ '#ts': 'timestamp' });
      expect(cmd.ExpressionAttributeValues).toEqual({ ':since': SINCE });
    });

    it('does not include ExclusiveStartKey on first page', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await fraudRepo.scanEventsSince(SINCE);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.ExclusiveStartKey).toBeUndefined();
    });

    it('follows LastEvaluatedKey across multiple pages', async () => {
      const page1 = [{ accountId: ACC, timestamp: '2026-04-05T00:00:00.000Z', eventType: 'a' }];
      const page2 = [{ accountId: ACC, timestamp: '2026-04-06T00:00:00.000Z', eventType: 'b' }];
      const page3 = [{ accountId: ACC, timestamp: '2026-04-07T00:00:00.000Z', eventType: 'c' }];
      mockSend
        .mockResolvedValueOnce({
          Items: page1,
          LastEvaluatedKey: { accountId: ACC, timestamp: 't1' },
        })
        .mockResolvedValueOnce({
          Items: page2,
          LastEvaluatedKey: { accountId: ACC, timestamp: 't2' },
        })
        .mockResolvedValueOnce({ Items: page3 });

      const result = await fraudRepo.scanEventsSince(SINCE);

      expect(result).toEqual([...page1, ...page2, ...page3]);
      expect(mockSend).toHaveBeenCalledTimes(3);
      expect(mockSend.mock.calls[1][0].ExclusiveStartKey).toEqual({
        accountId: ACC,
        timestamp: 't1',
      });
      expect(mockSend.mock.calls[2][0].ExclusiveStartKey).toEqual({
        accountId: ACC,
        timestamp: 't2',
      });
    });

    it('returns empty array when no pages have items', async () => {
      mockSend.mockResolvedValueOnce({ Items: undefined });
      const result = await fraudRepo.scanEventsSince(SINCE);
      expect(result).toEqual([]);
    });

    it('handles empty-items pages mixed with populated pages', async () => {
      mockSend
        .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { timestamp: 't1' } })
        .mockResolvedValueOnce({
          Items: [{ accountId: ACC, timestamp: '2026-04-12T00:00:00.000Z', eventType: 'x' }],
        });
      const result = await fraudRepo.scanEventsSince(SINCE);
      expect(result).toHaveLength(1);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('propagates DDB scan errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('ScanFailed'));
      await expect(fraudRepo.scanEventsSince(SINCE)).rejects.toThrow('ScanFailed');
    });
  });

  describe('getTally', () => {
    it('returns tally when found', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            accountId: ACC,
            windowKey: 'velocity:2026-04-05T12:05',
            eventCount: 7,
            lastEventAt: new Date().toISOString(),
          },
        ],
      });
      const result = await fraudRepo.getTally(ACC, 'velocity:2026-04-05T12:05');
      expect(result.eventCount).toBe(7);
    });

    it('returns zero-count default when not found', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      const result = await fraudRepo.getTally(ACC, 'velocity:2026-04-05T12:05');
      expect(result.eventCount).toBe(0);
      expect(result.accountId).toBe(ACC);
    });

    it('queries correct table with composite key', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await fraudRepo.getTally(ACC, 'nonce-fail:2026-04-05T12:05');
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._type).toBe('Query');
      expect(cmd.TableName).toBe('x402-fraud-tally');
      expect(cmd.ExpressionAttributeValues[':a']).toBe(ACC);
      expect(cmd.ExpressionAttributeValues[':w']).toBe('nonce-fail:2026-04-05T12:05');
    });
  });
});

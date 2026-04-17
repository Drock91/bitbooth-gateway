import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {},
}));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
  DeleteCommand: vi.fn(function (p) {
    Object.assign(this, { _type: 'Delete', ...p });
  }),
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

import { idempotencyRepo } from '../../src/repositories/idempotency.repo.js';

describe('idempotencyRepo', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  describe('get', () => {
    it('returns item when found', async () => {
      const item = { idempotencyKey: 'k1', status: 'completed' };
      mockSend.mockResolvedValueOnce({ Item: item });
      const result = await idempotencyRepo.get('k1');
      expect(result).toEqual(item);
    });

    it('returns null when not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      const result = await idempotencyRepo.get('missing');
      expect(result).toBeNull();
    });

    it('sends GetCommand with correct table and key', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      await idempotencyRepo.get('k1');
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._type).toBe('Get');
      expect(cmd.TableName).toBe('x402-idempotency');
      expect(cmd.Key).toEqual({ idempotencyKey: 'k1' });
    });
  });

  describe('lockKey', () => {
    it('puts item with in_progress status', async () => {
      mockSend.mockResolvedValueOnce({});
      await idempotencyRepo.lockKey('k1');
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._type).toBe('Put');
      expect(cmd.Item.idempotencyKey).toBe('k1');
      expect(cmd.Item.status).toBe('in_progress');
      expect(cmd.Item.createdAt).toBeDefined();
      expect(cmd.Item.ttl).toBeGreaterThan(0);
    });

    it('uses ConditionExpression to prevent duplicates', async () => {
      mockSend.mockResolvedValueOnce({});
      await idempotencyRepo.lockKey('k1');
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.ConditionExpression).toBe('attribute_not_exists(idempotencyKey)');
    });

    it('throws ConflictError on duplicate key', async () => {
      const err = new Error('conditional');
      err.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(err);
      await expect(idempotencyRepo.lockKey('k1')).rejects.toThrow('idempotency key already in use');
    });

    it('ConflictError has status 409', async () => {
      const err = new Error('conditional');
      err.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(err);
      try {
        await idempotencyRepo.lockKey('k1');
      } catch (e) {
        expect(e.name).toBe('ConflictError');
        expect(e.status).toBe(409);
        return;
      }
      throw new Error('expected error');
    });

    it('re-throws unexpected errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('network'));
      await expect(idempotencyRepo.lockKey('k1')).rejects.toThrow('network');
    });

    it('sets TTL to ~24h from now', async () => {
      mockSend.mockResolvedValueOnce({});
      const before = Math.floor(Date.now() / 1000) + 86400 - 5;
      await idempotencyRepo.lockKey('k1');
      const cmd = mockSend.mock.calls[0][0];
      const after = Math.floor(Date.now() / 1000) + 86400 + 5;
      expect(cmd.Item.ttl).toBeGreaterThanOrEqual(before);
      expect(cmd.Item.ttl).toBeLessThanOrEqual(after);
    });
  });

  describe('complete', () => {
    it('sends UpdateCommand with correct key', async () => {
      mockSend.mockResolvedValueOnce({});
      await idempotencyRepo.complete('k1', 200, '{"ok":true}', {
        'content-type': 'application/json',
      });
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._type).toBe('Update');
      expect(cmd.Key).toEqual({ idempotencyKey: 'k1' });
    });

    it('sets status to completed with response data', async () => {
      mockSend.mockResolvedValueOnce({});
      await idempotencyRepo.complete('k1', 200, '{"ok":true}', {
        'content-type': 'application/json',
      });
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.ExpressionAttributeValues[':s']).toBe('completed');
      expect(cmd.ExpressionAttributeValues[':sc']).toBe(200);
      expect(cmd.ExpressionAttributeValues[':rb']).toBe('{"ok":true}');
      expect(cmd.ExpressionAttributeValues[':rh']).toEqual({ 'content-type': 'application/json' });
    });

    it('sets completedAt timestamp', async () => {
      mockSend.mockResolvedValueOnce({});
      await idempotencyRepo.complete('k1', 200, '{}', {});
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.ExpressionAttributeValues[':ca']).toBeDefined();
    });

    it('refreshes TTL on completion', async () => {
      mockSend.mockResolvedValueOnce({});
      const before = Math.floor(Date.now() / 1000) + 86400 - 5;
      await idempotencyRepo.complete('k1', 200, '{}', {});
      const cmd = mockSend.mock.calls[0][0];
      const after = Math.floor(Date.now() / 1000) + 86400 + 5;
      expect(cmd.ExpressionAttributeValues[':t']).toBeGreaterThanOrEqual(before);
      expect(cmd.ExpressionAttributeValues[':t']).toBeLessThanOrEqual(after);
    });

    it('uses correct table name', async () => {
      mockSend.mockResolvedValueOnce({});
      await idempotencyRepo.complete('k1', 200, '{}', {});
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.TableName).toBe('x402-idempotency');
    });
  });

  describe('release', () => {
    it('sends DeleteCommand with correct key', async () => {
      mockSend.mockResolvedValueOnce({});
      await idempotencyRepo.release('k1');
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._type).toBe('Delete');
      expect(cmd.Key).toEqual({ idempotencyKey: 'k1' });
    });

    it('uses correct table name', async () => {
      mockSend.mockResolvedValueOnce({});
      await idempotencyRepo.release('k1');
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.TableName).toBe('x402-idempotency');
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {},
}));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
  PutCommand: vi.fn(function (p) {
    Object.assign(this, { _type: 'Put', _params: p });
  }),
  QueryCommand: vi.fn(function (p) {
    Object.assign(this, { _type: 'Query', _params: p });
  }),
  UpdateCommand: vi.fn(function (p) {
    Object.assign(this, { _type: 'Update', _params: p });
  }),
}));
vi.mock('../../src/lib/config.js', () => ({
  getConfig: () => ({ awsRegion: 'us-east-1' }),
}));

import { webhookDlqRepo } from '../../src/repositories/webhook-dlq.repo.js';

const validInput = {
  eventId: '550e8400-e29b-41d4-a716-446655440000',
  provider: 'moonpay',
  payload: '{"data":1}',
  headers: { 'x-signature': 'abc123' },
  errorMessage: 'webhook signature invalid',
  errorCode: 'UNAUTHORIZED',
};

describe('webhookDlqRepo', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  // --- record ---

  describe('record', () => {
    it('puts item with correct table name', async () => {
      mockSend.mockResolvedValue({});
      await webhookDlqRepo.record(validInput);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._params.TableName).toBe('x402-webhook-dlq');
    });

    it('returns parsed item with status=pending and retryCount=0', async () => {
      mockSend.mockResolvedValue({});
      const item = await webhookDlqRepo.record(validInput);
      expect(item.status).toBe('pending');
      expect(item.retryCount).toBe(0);
      expect(item.eventId).toBe(validInput.eventId);
      expect(item.provider).toBe('moonpay');
    });

    it('sets createdAt and updatedAt to ISO datetime', async () => {
      mockSend.mockResolvedValue({});
      const item = await webhookDlqRepo.record(validInput);
      expect(item.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(item.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('sets TTL 30 days in the future', async () => {
      mockSend.mockResolvedValue({});
      const item = await webhookDlqRepo.record(validInput);
      const nowSec = Math.floor(Date.now() / 1000);
      expect(item.ttl).toBeGreaterThan(nowSec + 29 * 86400);
      expect(item.ttl).toBeLessThanOrEqual(nowSec + 30 * 86400 + 1);
    });

    it('passes payload and headers through', async () => {
      mockSend.mockResolvedValue({});
      const item = await webhookDlqRepo.record(validInput);
      expect(item.payload).toBe('{"data":1}');
      expect(item.headers).toEqual({ 'x-signature': 'abc123' });
    });

    it('passes errorMessage and errorCode through', async () => {
      mockSend.mockResolvedValue({});
      const item = await webhookDlqRepo.record(validInput);
      expect(item.errorMessage).toBe('webhook signature invalid');
      expect(item.errorCode).toBe('UNAUTHORIZED');
    });

    it('propagates DDB errors', async () => {
      mockSend.mockRejectedValue(new Error('DDB down'));
      await expect(webhookDlqRepo.record(validInput)).rejects.toThrow('DDB down');
    });
  });

  // --- listByProvider ---

  describe('listByProvider', () => {
    it('queries gsi-provider with correct key condition', async () => {
      mockSend.mockResolvedValue({ Items: [] });
      await webhookDlqRepo.listByProvider('coinbase');
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._params.IndexName).toBe('gsi-provider');
      expect(cmd._params.KeyConditionExpression).toBe('provider = :p');
      expect(cmd._params.ExpressionAttributeValues[':p']).toBe('coinbase');
    });

    it('returns items parsed through Zod schema', async () => {
      const now = new Date().toISOString();
      mockSend.mockResolvedValue({
        Items: [
          {
            eventId: '550e8400-e29b-41d4-a716-446655440000',
            provider: 'coinbase',
            payload: '{}',
            headers: {},
            errorMessage: 'fail',
            errorCode: 'INTERNAL_ERROR',
            status: 'pending',
            retryCount: 0,
            createdAt: now,
            updatedAt: now,
          },
        ],
      });
      const result = await webhookDlqRepo.listByProvider('coinbase');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].provider).toBe('coinbase');
    });

    it('returns empty items array when no results', async () => {
      mockSend.mockResolvedValue({ Items: undefined });
      const result = await webhookDlqRepo.listByProvider('moonpay');
      expect(result.items).toEqual([]);
      expect(result.lastKey).toBeNull();
    });

    it('passes limit parameter', async () => {
      mockSend.mockResolvedValue({ Items: [] });
      await webhookDlqRepo.listByProvider('moonpay', 5);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._params.Limit).toBe(5);
    });

    it('defaults limit to 20', async () => {
      mockSend.mockResolvedValue({ Items: [] });
      await webhookDlqRepo.listByProvider('moonpay');
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._params.Limit).toBe(20);
    });

    it('uses ScanIndexForward=false for newest first', async () => {
      mockSend.mockResolvedValue({ Items: [] });
      await webhookDlqRepo.listByProvider('moonpay');
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._params.ScanIndexForward).toBe(false);
    });

    it('passes cursor as ExclusiveStartKey', async () => {
      mockSend.mockResolvedValue({ Items: [] });
      const cursor = { eventId: 'abc' };
      await webhookDlqRepo.listByProvider('moonpay', 10, cursor);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._params.ExclusiveStartKey).toEqual(cursor);
    });

    it('returns lastKey from LastEvaluatedKey', async () => {
      const lastKey = { eventId: 'next-page' };
      mockSend.mockResolvedValue({ Items: [], LastEvaluatedKey: lastKey });
      const result = await webhookDlqRepo.listByProvider('moonpay');
      expect(result.lastKey).toEqual(lastKey);
    });

    it('does not set ExclusiveStartKey when cursor is undefined', async () => {
      mockSend.mockResolvedValue({ Items: [] });
      await webhookDlqRepo.listByProvider('moonpay');
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._params.ExclusiveStartKey).toBeUndefined();
    });
  });

  // --- listPending ---

  describe('listPending', () => {
    it('queries gsi-status with status=pending', async () => {
      mockSend.mockResolvedValue({ Items: [] });
      await webhookDlqRepo.listPending();
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._params.IndexName).toBe('gsi-status');
      expect(cmd._params.ExpressionAttributeValues[':s']).toBe('pending');
    });

    it('uses ExpressionAttributeNames for reserved word status', async () => {
      mockSend.mockResolvedValue({ Items: [] });
      await webhookDlqRepo.listPending();
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._params.ExpressionAttributeNames['#s']).toBe('status');
    });

    it('defaults limit to 20', async () => {
      mockSend.mockResolvedValue({ Items: [] });
      await webhookDlqRepo.listPending();
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._params.Limit).toBe(20);
    });

    it('passes custom limit', async () => {
      mockSend.mockResolvedValue({ Items: [] });
      await webhookDlqRepo.listPending(50);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._params.Limit).toBe(50);
    });

    it('passes cursor as ExclusiveStartKey', async () => {
      mockSend.mockResolvedValue({ Items: [] });
      const cursor = { eventId: 'x' };
      await webhookDlqRepo.listPending(10, cursor);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._params.ExclusiveStartKey).toEqual(cursor);
    });

    it('returns empty items when no pending events', async () => {
      mockSend.mockResolvedValue({ Items: undefined });
      const result = await webhookDlqRepo.listPending();
      expect(result.items).toEqual([]);
      expect(result.lastKey).toBeNull();
    });

    it('returns parsed items when pending events exist', async () => {
      const now = new Date().toISOString();
      const item = {
        eventId: '550e8400-e29b-41d4-a716-446655440000',
        provider: 'moonpay',
        payload: '{}',
        headers: {},
        errorMessage: 'sig fail',
        errorCode: 'UNAUTHORIZED',
        status: 'pending',
        retryCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      mockSend.mockResolvedValue({ Items: [item] });
      const result = await webhookDlqRepo.listPending();
      expect(result.items).toHaveLength(1);
      expect(result.items[0].eventId).toBe(item.eventId);
      expect(result.items[0].status).toBe('pending');
    });
  });

  // --- incrementRetry ---

  describe('incrementRetry', () => {
    const baseAttrs = {
      eventId: '550e8400-e29b-41d4-a716-446655440000',
      provider: 'moonpay',
      payload: '{}',
      headers: {},
      errorMessage: 'fail',
      errorCode: 'UNAUTHORIZED',
      status: 'pending',
      retryCount: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    it('sends UpdateCommand with retryCount increment', async () => {
      mockSend.mockResolvedValue({ Attributes: baseAttrs });
      await webhookDlqRepo.incrementRetry(baseAttrs.eventId);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._params.UpdateExpression).toBe(
        'SET retryCount = retryCount + :one, updatedAt = :now',
      );
      expect(cmd._params.ExpressionAttributeValues[':one']).toBe(1);
    });

    it('preserves status (does not change it)', async () => {
      mockSend.mockResolvedValue({ Attributes: baseAttrs });
      await webhookDlqRepo.incrementRetry(baseAttrs.eventId);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._params.UpdateExpression).not.toContain('#s');
    });

    it('sets ConditionExpression for existence check', async () => {
      mockSend.mockResolvedValue({ Attributes: baseAttrs });
      await webhookDlqRepo.incrementRetry(baseAttrs.eventId);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._params.ConditionExpression).toBe('attribute_exists(eventId)');
    });

    it('returns parsed item', async () => {
      mockSend.mockResolvedValue({ Attributes: baseAttrs });
      const result = await webhookDlqRepo.incrementRetry(baseAttrs.eventId);
      expect(result.retryCount).toBe(1);
      expect(result.status).toBe('pending');
    });

    it('throws NotFoundError when Attributes is missing', async () => {
      mockSend.mockResolvedValue({});
      await expect(webhookDlqRepo.incrementRetry('missing-id')).rejects.toThrow('DLQ event');
    });

    it('uses ReturnValues ALL_NEW', async () => {
      mockSend.mockResolvedValue({ Attributes: baseAttrs });
      await webhookDlqRepo.incrementRetry(baseAttrs.eventId);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._params.ReturnValues).toBe('ALL_NEW');
    });
  });

  // --- updateStatus ---

  describe('updateStatus', () => {
    const validAttrs = {
      eventId: '550e8400-e29b-41d4-a716-446655440000',
      provider: 'moonpay',
      payload: '{}',
      headers: {},
      errorMessage: 'fail',
      errorCode: 'UNAUTHORIZED',
      status: 'resolved',
      retryCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    it('updates with ConditionExpression to check existence', async () => {
      mockSend.mockResolvedValue({ Attributes: validAttrs });
      await webhookDlqRepo.updateStatus(validAttrs.eventId, 'resolved');
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._params.ConditionExpression).toBe('attribute_exists(eventId)');
    });

    it('returns parsed item on success', async () => {
      mockSend.mockResolvedValue({ Attributes: validAttrs });
      const result = await webhookDlqRepo.updateStatus(validAttrs.eventId, 'resolved');
      expect(result.status).toBe('resolved');
    });

    it('increments retryCount when status is retried', async () => {
      const retriedAttrs = { ...validAttrs, status: 'retried', retryCount: 1 };
      mockSend.mockResolvedValue({ Attributes: retriedAttrs });
      await webhookDlqRepo.updateStatus(validAttrs.eventId, 'retried');
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._params.UpdateExpression).toContain('retryCount = retryCount + :one');
      expect(cmd._params.ExpressionAttributeValues[':one']).toBe(1);
    });

    it('does not increment retryCount when status is resolved', async () => {
      mockSend.mockResolvedValue({ Attributes: validAttrs });
      await webhookDlqRepo.updateStatus(validAttrs.eventId, 'resolved');
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._params.UpdateExpression).not.toContain('retryCount');
    });

    it('sets updatedAt on every status change', async () => {
      mockSend.mockResolvedValue({ Attributes: validAttrs });
      await webhookDlqRepo.updateStatus(validAttrs.eventId, 'resolved');
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._params.UpdateExpression).toContain('updatedAt = :now');
    });

    it('uses ReturnValues ALL_NEW', async () => {
      mockSend.mockResolvedValue({ Attributes: validAttrs });
      await webhookDlqRepo.updateStatus(validAttrs.eventId, 'resolved');
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._params.ReturnValues).toBe('ALL_NEW');
    });

    it('throws NotFoundError when Attributes is missing', async () => {
      mockSend.mockResolvedValue({});
      await expect(webhookDlqRepo.updateStatus('missing-id', 'resolved')).rejects.toThrow(
        'DLQ event',
      );
    });

    it('propagates ConditionalCheckFailedException', async () => {
      const err = new Error('condition');
      err.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValue(err);
      await expect(webhookDlqRepo.updateStatus('bad-id', 'resolved')).rejects.toThrow('condition');
    });

    it('uses ExpressionAttributeNames for reserved word status', async () => {
      mockSend.mockResolvedValue({ Attributes: validAttrs });
      await webhookDlqRepo.updateStatus(validAttrs.eventId, 'resolved');
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._params.ExpressionAttributeNames['#s']).toBe('status');
    });
  });
});

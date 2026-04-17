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
  UpdateCommand: vi.fn(function (p) {
    Object.assign(this, { _type: 'Update', ...p });
  }),
}));
vi.mock('../../src/lib/config.js', () => ({
  getConfig: () => ({ awsRegion: 'us-east-1' }),
}));

import {
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { tenantsRepo } from '../../src/repositories/tenants.repo.js';
import { NotFoundError, ConflictError } from '../../src/lib/errors.js';

const validTenant = {
  accountId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  apiKeyHash: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  plan: 'free',
  createdAt: '2026-04-05T00:00:00.000Z',
};

describe('tenantsRepo', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  describe('getByAccountId', () => {
    it('returns validated tenant when found', async () => {
      mockSend.mockResolvedValueOnce({ Item: { ...validTenant } });
      const result = await tenantsRepo.getByAccountId(validTenant.accountId);
      expect(result.accountId).toBe(validTenant.accountId);
      expect(result.plan).toBe('free');
    });

    it('throws NotFoundError when item is missing', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      await expect(
        tenantsRepo.getByAccountId('a1b2c3d4-e5f6-7890-abcd-ef1234567890'),
      ).rejects.toThrow('Tenant not found');
    });

    it('throws NotFoundError instance with correct type', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      await expect(
        tenantsRepo.getByAccountId('a1b2c3d4-e5f6-7890-abcd-ef1234567890'),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('sends GetCommand with correct table and key', async () => {
      mockSend.mockResolvedValueOnce({ Item: { ...validTenant } });
      await tenantsRepo.getByAccountId('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
      expect(GetCommand).toHaveBeenCalledWith({
        TableName: 'x402-tenants',
        Key: { accountId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
      });
    });
  });

  describe('getByApiKeyHash', () => {
    it('returns tenant via GSI query', async () => {
      mockSend.mockResolvedValueOnce({ Items: [{ ...validTenant }] });
      const result = await tenantsRepo.getByApiKeyHash(validTenant.apiKeyHash);
      expect(result.apiKeyHash).toBe(validTenant.apiKeyHash);
    });

    it('returns null when no match', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      const result = await tenantsRepo.getByApiKeyHash(
        '0000000000000000000000000000000000000000000000000000000000000000',
      );
      expect(result).toBeNull();
    });

    it('returns null when Items is undefined', async () => {
      mockSend.mockResolvedValueOnce({});
      const result = await tenantsRepo.getByApiKeyHash(
        '0000000000000000000000000000000000000000000000000000000000000000',
      );
      expect(result).toBeNull();
    });

    it('sends QueryCommand with GSI and Limit 1', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await tenantsRepo.getByApiKeyHash('abcd'.repeat(16));
      expect(QueryCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          IndexName: 'gsi-apiKeyHash',
          Limit: 1,
        }),
      );
    });
  });

  describe('getByStripeCustomerId', () => {
    it('returns tenant when found via GSI', async () => {
      const tenant = { ...validTenant, stripeCustomerId: 'cus_abc123' };
      mockSend.mockResolvedValueOnce({ Items: [tenant] });
      const result = await tenantsRepo.getByStripeCustomerId('cus_abc123');
      expect(result.accountId).toBe(validTenant.accountId);
    });

    it('returns null when no match', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      const result = await tenantsRepo.getByStripeCustomerId('cus_nonexistent');
      expect(result).toBeNull();
    });

    it('returns null when Items is undefined', async () => {
      mockSend.mockResolvedValueOnce({});
      const result = await tenantsRepo.getByStripeCustomerId('cus_nonexistent');
      expect(result).toBeNull();
    });

    it('sends QueryCommand with stripeCustomerId GSI', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await tenantsRepo.getByStripeCustomerId('cus_test');
      expect(QueryCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          IndexName: 'gsi-stripeCustomerId',
          KeyConditionExpression: 'stripeCustomerId = :c',
          ExpressionAttributeValues: { ':c': 'cus_test' },
          Limit: 1,
        }),
      );
    });
  });

  describe('create', () => {
    it('inserts tenant and returns validated item', async () => {
      mockSend.mockResolvedValueOnce({});
      const result = await tenantsRepo.create({
        accountId: validTenant.accountId,
        apiKeyHash: validTenant.apiKeyHash,
        plan: 'starter',
      });
      expect(result.accountId).toBe(validTenant.accountId);
      expect(result.plan).toBe('starter');
      expect(result.createdAt).toBeDefined();
    });

    it('defaults plan to free when omitted', async () => {
      mockSend.mockResolvedValueOnce({});
      const result = await tenantsRepo.create({
        accountId: validTenant.accountId,
        apiKeyHash: validTenant.apiKeyHash,
      });
      expect(result.plan).toBe('free');
    });

    it('includes stripeCustomerId when provided', async () => {
      mockSend.mockResolvedValueOnce({});
      const result = await tenantsRepo.create({
        accountId: validTenant.accountId,
        apiKeyHash: validTenant.apiKeyHash,
        stripeCustomerId: 'cus_abc123',
      });
      expect(result.accountId).toBe(validTenant.accountId);
      expect(PutCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Item: expect.objectContaining({ stripeCustomerId: 'cus_abc123' }),
        }),
      );
    });

    it('sends PutCommand with condition to prevent duplicates', async () => {
      mockSend.mockResolvedValueOnce({});
      await tenantsRepo.create({
        accountId: validTenant.accountId,
        apiKeyHash: validTenant.apiKeyHash,
      });
      expect(PutCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ConditionExpression: 'attribute_not_exists(accountId)',
        }),
      );
    });

    it('throws ConflictError on duplicate accountId', async () => {
      const err = new Error('conditional');
      err.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(err);
      await expect(
        tenantsRepo.create({
          accountId: validTenant.accountId,
          apiKeyHash: validTenant.apiKeyHash,
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('re-throws unexpected errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('network'));
      await expect(
        tenantsRepo.create({
          accountId: validTenant.accountId,
          apiKeyHash: validTenant.apiKeyHash,
        }),
      ).rejects.toThrow('network');
    });
  });

  describe('updateApiKeyHash', () => {
    const newHash = '1111111111111111111111111111111111111111111111111111111111111111';

    it('updates apiKeyHash and returns validated tenant', async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: { ...validTenant, apiKeyHash: newHash },
      });
      const result = await tenantsRepo.updateApiKeyHash(validTenant.accountId, newHash);
      expect(result.apiKeyHash).toBe(newHash);
      expect(result.accountId).toBe(validTenant.accountId);
    });

    it('sends UpdateCommand with condition that account exists', async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: { ...validTenant, apiKeyHash: newHash },
      });
      await tenantsRepo.updateApiKeyHash(validTenant.accountId, newHash);
      expect(UpdateCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: { accountId: validTenant.accountId },
          UpdateExpression: 'SET apiKeyHash = :h',
          ExpressionAttributeValues: { ':h': newHash },
          ConditionExpression: 'attribute_exists(accountId)',
          ReturnValues: 'ALL_NEW',
        }),
      );
    });

    it('propagates DDB errors when account does not exist', async () => {
      const err = new Error('conditional');
      err.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(err);
      await expect(
        tenantsRepo.updateApiKeyHash('a1b2c3d4-e5f6-7890-abcd-ef1234567890', newHash),
      ).rejects.toThrow('conditional');
    });
  });

  describe('updateStatus', () => {
    const tenantWithStatus = { ...validTenant, status: 'suspended' };

    it('updates status and returns validated tenant', async () => {
      mockSend.mockResolvedValueOnce({ Attributes: tenantWithStatus });
      const result = await tenantsRepo.updateStatus(validTenant.accountId, 'suspended');
      expect(result.status).toBe('suspended');
      expect(result.accountId).toBe(validTenant.accountId);
    });

    it('sends UpdateCommand with correct params', async () => {
      mockSend.mockResolvedValueOnce({ Attributes: tenantWithStatus });
      await tenantsRepo.updateStatus(validTenant.accountId, 'suspended');
      expect(UpdateCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: { accountId: validTenant.accountId },
          UpdateExpression: 'SET #s = :s',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':s': 'suspended' },
          ConditionExpression: 'attribute_exists(accountId)',
          ReturnValues: 'ALL_NEW',
        }),
      );
    });

    it('propagates DDB errors when account does not exist', async () => {
      const err = new Error('conditional');
      err.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(err);
      await expect(
        tenantsRepo.updateStatus('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'active'),
      ).rejects.toThrow('conditional');
    });

    it('can set status back to active', async () => {
      const active = { ...validTenant, status: 'active' };
      mockSend.mockResolvedValueOnce({ Attributes: active });
      const result = await tenantsRepo.updateStatus(validTenant.accountId, 'active');
      expect(result.status).toBe('active');
    });
  });

  describe('updatePlan', () => {
    it('updates plan and returns validated tenant', async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: { ...validTenant, plan: 'growth' },
      });
      const result = await tenantsRepo.updatePlan(validTenant.accountId, 'growth');
      expect(result.plan).toBe('growth');
      expect(result.accountId).toBe(validTenant.accountId);
    });

    it('sends UpdateCommand with condition that account exists', async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: { ...validTenant, plan: 'scale' },
      });
      await tenantsRepo.updatePlan(validTenant.accountId, 'scale');
      expect(UpdateCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: { accountId: validTenant.accountId },
          UpdateExpression: 'SET #p = :p',
          ExpressionAttributeNames: { '#p': 'plan' },
          ExpressionAttributeValues: { ':p': 'scale' },
          ConditionExpression: 'attribute_exists(accountId)',
          ReturnValues: 'ALL_NEW',
        }),
      );
    });

    it('propagates DDB errors when account does not exist', async () => {
      const err = new Error('conditional');
      err.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(err);
      await expect(
        tenantsRepo.updatePlan('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'growth'),
      ).rejects.toThrow('conditional');
    });
  });

  describe('listAll', () => {
    it('returns validated items and null lastKey when no more pages', async () => {
      mockSend.mockResolvedValueOnce({ Items: [{ ...validTenant }], LastEvaluatedKey: undefined });
      const result = await tenantsRepo.listAll(10);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].accountId).toBe(validTenant.accountId);
      expect(result.lastKey).toBeNull();
    });

    it('returns lastKey when more pages exist', async () => {
      const lastKey = { accountId: 'next-page' };
      mockSend.mockResolvedValueOnce({ Items: [{ ...validTenant }], LastEvaluatedKey: lastKey });
      const result = await tenantsRepo.listAll(10);
      expect(result.lastKey).toEqual(lastKey);
    });

    it('sends ScanCommand with correct limit', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await tenantsRepo.listAll(50);
      expect(ScanCommand).toHaveBeenCalledWith(
        expect.objectContaining({ TableName: 'x402-tenants', Limit: 50 }),
      );
    });

    it('includes ExclusiveStartKey when startKey is provided', async () => {
      const startKey = { accountId: 'start-here' };
      mockSend.mockResolvedValueOnce({ Items: [] });
      await tenantsRepo.listAll(20, startKey);
      expect(ScanCommand).toHaveBeenCalledWith(
        expect.objectContaining({ ExclusiveStartKey: startKey }),
      );
    });

    it('does not include ExclusiveStartKey when startKey is undefined', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await tenantsRepo.listAll(20);
      const call = ScanCommand.mock.calls[0][0];
      expect(call).not.toHaveProperty('ExclusiveStartKey');
    });

    it('adds plan filter when plan is provided', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await tenantsRepo.listAll(20, undefined, 'growth');
      expect(ScanCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          FilterExpression: '#p = :p',
          ExpressionAttributeNames: { '#p': 'plan' },
          ExpressionAttributeValues: { ':p': 'growth' },
        }),
      );
    });

    it('does not add filter when plan is not provided', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await tenantsRepo.listAll(20);
      const call = ScanCommand.mock.calls[0][0];
      expect(call).not.toHaveProperty('FilterExpression');
    });

    it('returns empty items array when Items is undefined', async () => {
      mockSend.mockResolvedValueOnce({});
      const result = await tenantsRepo.listAll(20);
      expect(result.items).toEqual([]);
    });

    it('uses default limit of 20', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await tenantsRepo.listAll();
      expect(ScanCommand).toHaveBeenCalledWith(expect.objectContaining({ Limit: 20 }));
    });
  });
});

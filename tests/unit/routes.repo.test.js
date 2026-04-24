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
  DeleteCommand: vi.fn(function (p) {
    Object.assign(this, { _type: 'Delete', ...p });
  }),
}));
vi.mock('../../src/lib/config.js', () => ({
  getConfig: () => ({ awsRegion: 'us-east-1' }),
}));

import { GetCommand, PutCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { routesRepo } from '../../src/repositories/routes.repo.js';
import { NotFoundError, ConflictError } from '../../src/lib/errors.js';

const validRoute = {
  tenantId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  path: '/api/v1/premium',
  priceWei: '1000000',
  asset: 'USDC',
  createdAt: '2026-04-05T00:00:00.000Z',
  updatedAt: '2026-04-05T00:00:00.000Z',
};

describe('routesRepo', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  describe('getByTenantAndPath', () => {
    it('returns validated route when found', async () => {
      mockSend.mockResolvedValueOnce({ Item: { ...validRoute } });
      const result = await routesRepo.getByTenantAndPath(validRoute.tenantId, validRoute.path);
      expect(result.tenantId).toBe(validRoute.tenantId);
      expect(result.path).toBe(validRoute.path);
      expect(result.priceWei).toBe('1000000');
    });

    it('throws NotFoundError when item is missing', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      await expect(
        routesRepo.getByTenantAndPath('a1b2c3d4-e5f6-7890-abcd-ef1234567890', '/missing'),
      ).rejects.toThrow('Route not found');
    });

    it('throws NotFoundError instance with correct type', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      await expect(
        routesRepo.getByTenantAndPath('a1b2c3d4-e5f6-7890-abcd-ef1234567890', '/missing'),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('sends GetCommand with composite key (tenantId + path)', async () => {
      mockSend.mockResolvedValueOnce({ Item: { ...validRoute } });
      await routesRepo.getByTenantAndPath(
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        '/api/v1/premium',
      );
      expect(GetCommand).toHaveBeenCalledWith({
        TableName: 'x402-routes',
        Key: { tenantId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', path: '/api/v1/premium' },
      });
    });
  });

  describe('listByTenant', () => {
    it('returns all routes for a tenant', async () => {
      const route2 = { ...validRoute, path: '/api/v1/basic', priceWei: '500000' };
      mockSend.mockResolvedValueOnce({ Items: [{ ...validRoute }, route2] });
      const results = await routesRepo.listByTenant(validRoute.tenantId);
      expect(results).toHaveLength(2);
      expect(results[0].path).toBe('/api/v1/premium');
      expect(results[1].path).toBe('/api/v1/basic');
    });

    it('returns empty array when no routes exist', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      const results = await routesRepo.listByTenant('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
      expect(results).toEqual([]);
    });

    it('handles missing Items gracefully', async () => {
      mockSend.mockResolvedValueOnce({});
      const results = await routesRepo.listByTenant('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
      expect(results).toEqual([]);
    });

    it('sends QueryCommand with correct KeyConditionExpression', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await routesRepo.listByTenant('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
      expect(QueryCommand).toHaveBeenCalledWith({
        TableName: 'x402-routes',
        KeyConditionExpression: 'tenantId = :t',
        ExpressionAttributeValues: { ':t': 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
      });
    });

    it('validates each returned item through Zod', async () => {
      const badItem = { ...validRoute, path: 'no-leading-slash' };
      mockSend.mockResolvedValueOnce({ Items: [badItem] });
      await expect(routesRepo.listByTenant(validRoute.tenantId)).rejects.toThrow();
    });
  });

  describe('create', () => {
    it('inserts route and returns validated item', async () => {
      mockSend.mockResolvedValueOnce({});
      const result = await routesRepo.create({
        tenantId: validRoute.tenantId,
        path: validRoute.path,
        priceWei: '1000000',
        asset: 'USDC',
      });
      expect(result.tenantId).toBe(validRoute.tenantId);
      expect(result.path).toBe(validRoute.path);
      expect(result.priceWei).toBe('1000000');
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('defaults asset to USDC', async () => {
      mockSend.mockResolvedValueOnce({});
      const result = await routesRepo.create({
        tenantId: validRoute.tenantId,
        path: '/api/new',
        priceWei: '500',
      });
      expect(result.asset).toBe('USDC');
    });

    it('stores fraudRules when provided', async () => {
      mockSend.mockResolvedValueOnce({});
      const result = await routesRepo.create({
        tenantId: validRoute.tenantId,
        path: '/api/guarded',
        priceWei: '1000',
        fraudRules: { maxAmountWei: '9999999', velocityPerMinute: 10 },
      });
      expect(result.fraudRules.maxAmountWei).toBe('9999999');
      expect(result.fraudRules.velocityPerMinute).toBe(10);
    });

    it('sets both createdAt and updatedAt to the same timestamp', async () => {
      mockSend.mockResolvedValueOnce({});
      const result = await routesRepo.create({
        tenantId: validRoute.tenantId,
        path: '/api/timestamped',
        priceWei: '100',
      });
      expect(result.createdAt).toBe(result.updatedAt);
    });

    it('sends PutCommand with composite key condition to prevent duplicates', async () => {
      mockSend.mockResolvedValueOnce({});
      await routesRepo.create({
        tenantId: validRoute.tenantId,
        path: '/api/new',
        priceWei: '500',
      });
      expect(PutCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ConditionExpression: 'attribute_not_exists(tenantId) AND attribute_not_exists(#p)',
          ExpressionAttributeNames: { '#p': 'path' },
        }),
      );
    });

    it('throws ConflictError on duplicate tenant+path', async () => {
      const err = new Error('conditional');
      err.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(err);
      await expect(
        routesRepo.create({
          tenantId: validRoute.tenantId,
          path: validRoute.path,
          priceWei: '1000000',
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('includes correct message in ConflictError', async () => {
      const err = new Error('conditional');
      err.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(err);
      await expect(
        routesRepo.create({
          tenantId: validRoute.tenantId,
          path: validRoute.path,
          priceWei: '1000000',
        }),
      ).rejects.toThrow('Route already exists for this tenant and path');
    });

    it('re-throws unexpected errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('network'));
      await expect(
        routesRepo.create({
          tenantId: validRoute.tenantId,
          path: validRoute.path,
          priceWei: '1000000',
        }),
      ).rejects.toThrow('network');
    });

    it('stores cacheTtlSeconds when provided', async () => {
      mockSend.mockResolvedValueOnce({});
      const result = await routesRepo.create({
        tenantId: validRoute.tenantId,
        path: '/api/cached',
        priceWei: '1000',
        cacheTtlSeconds: 600,
      });
      expect(result.cacheTtlSeconds).toBe(600);
    });

    it('persists cacheTtlSeconds in DDB PutCommand', async () => {
      mockSend.mockResolvedValueOnce({});
      await routesRepo.create({
        tenantId: validRoute.tenantId,
        path: '/api/cached',
        priceWei: '1000',
        cacheTtlSeconds: 3600,
      });
      expect(PutCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Item: expect.objectContaining({ cacheTtlSeconds: 3600 }),
        }),
      );
    });

    it('leaves cacheTtlSeconds undefined when not provided', async () => {
      mockSend.mockResolvedValueOnce({});
      const result = await routesRepo.create({
        tenantId: validRoute.tenantId,
        path: '/api/no-ttl',
        priceWei: '500',
      });
      expect(result.cacheTtlSeconds).toBeUndefined();
    });
  });

  describe('update', () => {
    it('updates an existing route and returns validated item', async () => {
      mockSend.mockResolvedValueOnce({ Item: { ...validRoute } }); // getByTenantAndPath
      mockSend.mockResolvedValueOnce({}); // PutCommand
      const result = await routesRepo.update(validRoute.tenantId, validRoute.path, {
        priceWei: '2000000',
        asset: 'USDC',
      });
      expect(result.priceWei).toBe('2000000');
      expect(result.createdAt).toBe(validRoute.createdAt);
      expect(result.updatedAt).not.toBe(validRoute.updatedAt);
    });

    it('preserves createdAt from existing route', async () => {
      mockSend.mockResolvedValueOnce({ Item: { ...validRoute } });
      mockSend.mockResolvedValueOnce({});
      const result = await routesRepo.update(validRoute.tenantId, validRoute.path, {
        priceWei: '3000000',
      });
      expect(result.createdAt).toBe('2026-04-05T00:00:00.000Z');
    });

    it('throws NotFoundError when route does not exist', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      await expect(
        routesRepo.update('a1b2c3d4-e5f6-7890-abcd-ef1234567890', '/missing', { priceWei: '100' }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('sends PutCommand with updated fields', async () => {
      mockSend.mockResolvedValueOnce({ Item: { ...validRoute } });
      mockSend.mockResolvedValueOnce({});
      await routesRepo.update(validRoute.tenantId, validRoute.path, {
        priceWei: '5000000',
        asset: 'USDC',
        fraudRules: { maxAmountWei: '9999999' },
      });
      expect(PutCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'x402-routes',
          Item: expect.objectContaining({
            tenantId: validRoute.tenantId,
            path: validRoute.path,
            priceWei: '5000000',
            fraudRules: { maxAmountWei: '9999999' },
          }),
        }),
      );
    });

    it('defaults asset to USDC when not provided', async () => {
      mockSend.mockResolvedValueOnce({ Item: { ...validRoute } });
      mockSend.mockResolvedValueOnce({});
      const result = await routesRepo.update(validRoute.tenantId, validRoute.path, {
        priceWei: '100',
      });
      expect(result.asset).toBe('USDC');
    });

    it('stores cacheTtlSeconds on update', async () => {
      mockSend.mockResolvedValueOnce({ Item: { ...validRoute } });
      mockSend.mockResolvedValueOnce({});
      const result = await routesRepo.update(validRoute.tenantId, validRoute.path, {
        priceWei: '1000000',
        cacheTtlSeconds: 900,
      });
      expect(result.cacheTtlSeconds).toBe(900);
    });

    it('clears cacheTtlSeconds when omitted from update', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { ...validRoute, cacheTtlSeconds: 600 },
      });
      mockSend.mockResolvedValueOnce({});
      const result = await routesRepo.update(validRoute.tenantId, validRoute.path, {
        priceWei: '1000000',
      });
      expect(result.cacheTtlSeconds).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('deletes an existing route without error', async () => {
      mockSend.mockResolvedValueOnce({ Attributes: { ...validRoute } });
      await expect(
        routesRepo.delete(validRoute.tenantId, validRoute.path),
      ).resolves.toBeUndefined();
    });

    it('throws NotFoundError when route does not exist', async () => {
      mockSend.mockResolvedValueOnce({ Attributes: undefined });
      await expect(
        routesRepo.delete('a1b2c3d4-e5f6-7890-abcd-ef1234567890', '/missing'),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('sends DeleteCommand with ReturnValues ALL_OLD', async () => {
      mockSend.mockResolvedValueOnce({ Attributes: { ...validRoute } });
      await routesRepo.delete(validRoute.tenantId, validRoute.path);
      expect(DeleteCommand).toHaveBeenCalledWith({
        TableName: 'x402-routes',
        Key: { tenantId: validRoute.tenantId, path: validRoute.path },
        ReturnValues: 'ALL_OLD',
      });
    });
  });
});

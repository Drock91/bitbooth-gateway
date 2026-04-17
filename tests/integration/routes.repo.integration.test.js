import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { isLocalStackUp, createTable, destroyTable, ddbClient } from './helpers.js';
import { DynamoDBDocumentClient, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ScanCommand } from '@aws-sdk/client-dynamodb';

let available = false;
let routesRepo;

beforeAll(async () => {
  available = await isLocalStackUp();
  if (!available) return;
  await createTable('routes');
  const mod = await import('../../src/repositories/routes.repo.js');
  routesRepo = mod.routesRepo;
});

afterAll(async () => {
  if (available) await destroyTable('routes');
});

async function clearTable() {
  const res = await ddbClient.send(new ScanCommand({ TableName: 'x402-routes' }));
  if (!res.Items?.length) return;
  const docClient = DynamoDBDocumentClient.from(ddbClient);
  for (const item of res.Items) {
    await docClient.send(
      new DeleteCommand({
        TableName: 'x402-routes',
        Key: { tenantId: item.tenantId.S, path: item.path.S },
      }),
    );
  }
}

describe('routes.repo integration', () => {
  beforeEach(async () => {
    if (!available) return;
    await clearTable();
  });

  it.skipIf(!available)('creates and retrieves a route by tenant+path', async () => {
    const tenantId = randomUUID();
    const created = await routesRepo.create({
      tenantId,
      path: '/api/data',
      priceWei: '1000000',
    });

    expect(created.tenantId).toBe(tenantId);
    expect(created.path).toBe('/api/data');
    expect(created.priceWei).toBe('1000000');
    expect(created.asset).toBe('USDC');
    expect(created.createdAt).toBeTruthy();

    const fetched = await routesRepo.getByTenantAndPath(tenantId, '/api/data');
    expect(fetched.tenantId).toBe(tenantId);
    expect(fetched.priceWei).toBe('1000000');
  });

  it.skipIf(!available)('lists all routes for a tenant', async () => {
    const tenantId = randomUUID();
    await routesRepo.create({ tenantId, path: '/a', priceWei: '100' });
    await routesRepo.create({ tenantId, path: '/b', priceWei: '200' });

    const list = await routesRepo.listByTenant(tenantId);
    expect(list).toHaveLength(2);
    const paths = list.map((r) => r.path).sort();
    expect(paths).toEqual(['/a', '/b']);
  });

  it.skipIf(!available)('returns empty array when tenant has no routes', async () => {
    const list = await routesRepo.listByTenant(randomUUID());
    expect(list).toEqual([]);
  });

  it.skipIf(!available)('throws NotFoundError for unknown tenant+path', async () => {
    await expect(routesRepo.getByTenantAndPath(randomUUID(), '/nope')).rejects.toThrow('Route');
  });

  it.skipIf(!available)('throws ConflictError on duplicate tenant+path', async () => {
    const tenantId = randomUUID();
    await routesRepo.create({ tenantId, path: '/dup', priceWei: '500' });

    await expect(routesRepo.create({ tenantId, path: '/dup', priceWei: '999' })).rejects.toThrow(
      'already exists',
    );
  });

  it.skipIf(!available)('deletes a route and confirms it is gone', async () => {
    const tenantId = randomUUID();
    await routesRepo.create({ tenantId, path: '/del', priceWei: '100' });

    await routesRepo.delete(tenantId, '/del');

    await expect(routesRepo.getByTenantAndPath(tenantId, '/del')).rejects.toThrow('Route');
  });

  it.skipIf(!available)('throws NotFoundError when deleting non-existent route', async () => {
    await expect(routesRepo.delete(randomUUID(), '/ghost')).rejects.toThrow('Route');
  });

  it.skipIf(!available)('creates a route with fraud rules', async () => {
    const tenantId = randomUUID();
    const created = await routesRepo.create({
      tenantId,
      path: '/guarded',
      priceWei: '5000000',
      fraudRules: { maxAmountWei: '10000000', velocityPerMinute: 5 },
    });

    expect(created.fraudRules).toEqual({ maxAmountWei: '10000000', velocityPerMinute: 5 });

    const fetched = await routesRepo.getByTenantAndPath(tenantId, '/guarded');
    expect(fetched.fraudRules.maxAmountWei).toBe('10000000');
  });
});

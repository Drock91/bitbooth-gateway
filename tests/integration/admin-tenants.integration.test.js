import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { DynamoDBDocumentClient, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ScanCommand } from '@aws-sdk/client-dynamodb';
import { isLocalStackUp, createTable, destroyTable, ddbClient } from './helpers.js';

function hash(val) {
  return createHash('sha256').update(val).digest('hex');
}

let available = false;
let tenantsRepo;
let adminService;
const docClient = DynamoDBDocumentClient.from(ddbClient);

beforeAll(async () => {
  available = await isLocalStackUp();
  if (!available) return;
  await createTable('tenants');
  const repoMod = await import('../../src/repositories/tenants.repo.js');
  tenantsRepo = repoMod.tenantsRepo;
  const svcMod = await import('../../src/services/admin.service.js');
  adminService = svcMod.adminService;
});

afterAll(async () => {
  if (available) await destroyTable('tenants');
});

async function clearTable() {
  const res = await ddbClient.send(new ScanCommand({ TableName: 'x402-tenants' }));
  if (!res.Items?.length) return;
  for (const item of res.Items) {
    await docClient.send(
      new DeleteCommand({ TableName: 'x402-tenants', Key: { accountId: item.accountId.S } }),
    );
  }
}

async function seedTenants(count, planOverride) {
  const ids = [];
  for (let i = 0; i < count; i++) {
    const accountId = randomUUID();
    await tenantsRepo.create({
      accountId,
      apiKeyHash: hash(`key-${accountId}`),
      plan: planOverride ?? 'free',
    });
    ids.push(accountId);
  }
  return ids;
}

describe('admin tenant listing integration', () => {
  beforeEach(async () => {
    if (!available) return;
    await clearTable();
  });

  it.skipIf(!available)('lists all tenants when fewer than limit', async () => {
    const ids = await seedTenants(3);

    const result = await adminService.listTenants({ limit: 20 });

    expect(result.tenants).toHaveLength(3);
    expect(result.nextCursor).toBeNull();
    const returnedIds = result.tenants.map((t) => t.accountId);
    for (const id of ids) {
      expect(returnedIds).toContain(id);
    }
  });

  it.skipIf(!available)('returns empty list when no tenants exist', async () => {
    const result = await adminService.listTenants({ limit: 20 });

    expect(result.tenants).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
  });

  it.skipIf(!available)('paginates with cursor across multiple pages', async () => {
    const ids = await seedTenants(5);

    // Page 1: limit=2
    const page1 = await adminService.listTenants({ limit: 2 });
    expect(page1.tenants).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    // Page 2: use cursor from page 1
    const page2 = await adminService.listTenants({ limit: 2, cursor: page1.nextCursor });
    expect(page2.tenants).toHaveLength(2);
    expect(page2.nextCursor).not.toBeNull();

    // Page 3: last page
    const page3 = await adminService.listTenants({ limit: 2, cursor: page2.nextCursor });
    expect(page3.tenants).toHaveLength(1);
    expect(page3.nextCursor).toBeNull();

    // All 5 unique tenants returned across pages
    const allIds = [...page1.tenants, ...page2.tenants, ...page3.tenants].map((t) => t.accountId);
    expect(new Set(allIds).size).toBe(5);
    for (const id of ids) {
      expect(allIds).toContain(id);
    }
  });

  it.skipIf(!available)('filters tenants by plan', async () => {
    await seedTenants(3, 'free');
    const growthIds = await seedTenants(2, 'growth');

    const result = await adminService.listTenants({ plan: 'growth' });

    expect(result.tenants).toHaveLength(2);
    const returnedIds = result.tenants.map((t) => t.accountId);
    for (const id of growthIds) {
      expect(returnedIds).toContain(id);
    }
    for (const t of result.tenants) {
      expect(t.plan).toBe('growth');
    }
  });

  it.skipIf(!available)('returns empty when filtering by plan with no matches', async () => {
    await seedTenants(3, 'free');

    const result = await adminService.listTenants({ plan: 'scale' });

    expect(result.tenants).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
  });

  it.skipIf(!available)('paginates with plan filter', async () => {
    await seedTenants(2, 'free');
    await seedTenants(4, 'starter');

    // Page through starter tenants with limit=2
    const page1 = await adminService.listTenants({ limit: 2, plan: 'starter' });
    expect(page1.tenants.length).toBeGreaterThanOrEqual(1);
    for (const t of page1.tenants) {
      expect(t.plan).toBe('starter');
    }

    // Collect all starter tenants across pages
    const all = [...page1.tenants];
    let cursor = page1.nextCursor;
    while (cursor) {
      const next = await adminService.listTenants({ limit: 2, plan: 'starter', cursor });
      for (const t of next.tenants) {
        expect(t.plan).toBe('starter');
      }
      all.push(...next.tenants);
      cursor = next.nextCursor;
    }
    expect(all).toHaveLength(4);
  });

  it.skipIf(!available)('cursor encodes and decodes correctly', async () => {
    await seedTenants(3);

    const page1 = await adminService.listTenants({ limit: 1 });
    expect(page1.nextCursor).not.toBeNull();

    // Cursor should be valid base64url
    const decoded = JSON.parse(Buffer.from(page1.nextCursor, 'base64url').toString());
    expect(decoded).toHaveProperty('accountId');

    // Using decoded cursor should work
    const page2 = await adminService.listTenants({ limit: 1, cursor: page1.nextCursor });
    expect(page2.tenants).toHaveLength(1);
    expect(page2.tenants[0].accountId).not.toBe(page1.tenants[0].accountId);
  });

  it.skipIf(!available)('each tenant has expected shape', async () => {
    const accountId = randomUUID();
    await tenantsRepo.create({
      accountId,
      apiKeyHash: hash('shape-test'),
      plan: 'growth',
      stripeCustomerId: 'cus_shape_123',
    });

    const result = await adminService.listTenants({ limit: 10 });

    expect(result.tenants).toHaveLength(1);
    const tenant = result.tenants[0];
    expect(tenant.accountId).toBe(accountId);
    expect(tenant.apiKeyHash).toBe(hash('shape-test'));
    expect(tenant.plan).toBe('growth');
    expect(tenant.stripeCustomerId).toBe('cus_shape_123');
    expect(tenant.createdAt).toBeTruthy();
  });

  it.skipIf(!available)('limit=1 returns exactly one tenant per page', async () => {
    await seedTenants(3);

    let count = 0;
    let cursor = undefined;
    do {
      const page = await adminService.listTenants({ limit: 1, cursor });
      expect(page.tenants).toHaveLength(1);
      count++;
      cursor = page.nextCursor;
    } while (cursor);

    expect(count).toBe(3);
  });

  it.skipIf(!available)('multiple plans coexist and filter independently', async () => {
    await seedTenants(2, 'free');
    await seedTenants(3, 'starter');
    await seedTenants(1, 'growth');
    await seedTenants(1, 'scale');

    const free = await adminService.listTenants({ plan: 'free' });
    const starter = await adminService.listTenants({ plan: 'starter' });
    const growth = await adminService.listTenants({ plan: 'growth' });
    const scale = await adminService.listTenants({ plan: 'scale' });

    expect(free.tenants).toHaveLength(2);
    expect(starter.tenants).toHaveLength(3);
    expect(growth.tenants).toHaveLength(1);
    expect(scale.tenants).toHaveLength(1);

    const all = await adminService.listTenants({ limit: 100 });
    expect(all.tenants).toHaveLength(7);
  });

  it.skipIf(!available)('default limit returns up to 20 tenants', async () => {
    await seedTenants(5);

    const result = await adminService.listTenants();

    expect(result.tenants).toHaveLength(5);
    expect(result.nextCursor).toBeNull();
  });

  it.skipIf(!available)(
    'handles plan filter with pagination when DDB scan returns mixed results',
    async () => {
      // DDB Scan with FilterExpression may return fewer items than Limit
      // because filtering happens after the scan page is read
      await seedTenants(5, 'free');
      await seedTenants(5, 'growth');

      const allGrowth = [];
      let cursor = undefined;
      let iterations = 0;
      do {
        const page = await adminService.listTenants({ limit: 3, plan: 'growth', cursor });
        for (const t of page.tenants) {
          expect(t.plan).toBe('growth');
        }
        allGrowth.push(...page.tenants);
        cursor = page.nextCursor;
        iterations++;
      } while (cursor && iterations < 20);

      expect(allGrowth).toHaveLength(5);
    },
  );
});

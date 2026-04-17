import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { isLocalStackUp, createTable, destroyTable, ddbClient } from './helpers.js';
import { DynamoDBDocumentClient, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ScanCommand } from '@aws-sdk/client-dynamodb';

let available = false;
let tenantsRepo;

function hash(val) {
  return createHash('sha256').update(val).digest('hex');
}

beforeAll(async () => {
  available = await isLocalStackUp();
  if (!available) return;
  await createTable('tenants');
  const mod = await import('../../src/repositories/tenants.repo.js');
  tenantsRepo = mod.tenantsRepo;
});

afterAll(async () => {
  if (available) await destroyTable('tenants');
});

async function clearTable() {
  const res = await ddbClient.send(new ScanCommand({ TableName: 'x402-tenants' }));
  if (!res.Items?.length) return;
  const docClient = DynamoDBDocumentClient.from(ddbClient);
  for (const item of res.Items) {
    await docClient.send(
      new DeleteCommand({ TableName: 'x402-tenants', Key: { accountId: item.accountId.S } }),
    );
  }
}

describe('tenants.repo integration', () => {
  beforeEach(async () => {
    if (!available) return;
    await clearTable();
  });

  it.skipIf(!available)('creates and retrieves a tenant by accountId', async () => {
    const accountId = randomUUID();
    const apiKeyHash = hash(accountId);
    const created = await tenantsRepo.create({ accountId, apiKeyHash });

    expect(created.accountId).toBe(accountId);
    expect(created.apiKeyHash).toBe(apiKeyHash);
    expect(created.plan).toBe('free');
    expect(created.createdAt).toBeTruthy();

    const fetched = await tenantsRepo.getByAccountId(accountId);
    expect(fetched.accountId).toBe(accountId);
  });

  it.skipIf(!available)('looks up a tenant by apiKeyHash via GSI', async () => {
    const accountId = randomUUID();
    const apiKeyHash = hash(accountId);
    await tenantsRepo.create({ accountId, apiKeyHash });

    const result = await tenantsRepo.getByApiKeyHash(apiKeyHash);
    expect(result).not.toBeNull();
    expect(result.accountId).toBe(accountId);
  });

  it.skipIf(!available)('returns null for unknown apiKeyHash', async () => {
    const result = await tenantsRepo.getByApiKeyHash(hash('nonexistent'));
    expect(result).toBeNull();
  });

  it.skipIf(!available)('throws NotFoundError for unknown accountId', async () => {
    await expect(tenantsRepo.getByAccountId(randomUUID())).rejects.toThrow('Tenant');
  });

  it.skipIf(!available)('throws ConflictError on duplicate accountId', async () => {
    const accountId = randomUUID();
    const apiKeyHash = hash(accountId);
    await tenantsRepo.create({ accountId, apiKeyHash });

    await expect(tenantsRepo.create({ accountId, apiKeyHash: hash('other') })).rejects.toThrow(
      'already exists',
    );
  });

  it.skipIf(!available)('updates a tenant plan', async () => {
    const accountId = randomUUID();
    await tenantsRepo.create({ accountId, apiKeyHash: hash(accountId) });

    const updated = await tenantsRepo.updatePlan(accountId, 'growth');
    expect(updated.plan).toBe('growth');

    const fetched = await tenantsRepo.getByAccountId(accountId);
    expect(fetched.plan).toBe('growth');
  });

  it.skipIf(!available)('looks up a tenant by stripeCustomerId via GSI', async () => {
    const accountId = randomUUID();
    const stripeCustomerId = `cus_${randomUUID().slice(0, 14)}`;
    await tenantsRepo.create({
      accountId,
      apiKeyHash: hash(accountId),
      stripeCustomerId,
    });

    const result = await tenantsRepo.getByStripeCustomerId(stripeCustomerId);
    expect(result).not.toBeNull();
    expect(result.accountId).toBe(accountId);
  });

  it.skipIf(!available)('returns null for unknown stripeCustomerId', async () => {
    const result = await tenantsRepo.getByStripeCustomerId('cus_nonexistent123');
    expect(result).toBeNull();
  });
});

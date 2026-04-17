import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { isLocalStackUp, createTable, destroyTable, ddbClient } from './helpers.js';
import { DynamoDBDocumentClient, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ScanCommand } from '@aws-sdk/client-dynamodb';

let available = false;
let tenantsRepo;
let stripeService;

function hash(val) {
  return createHash('sha256').update(val).digest('hex');
}

function makeSubscriptionEvent(
  type,
  customerId,
  { lookupKey = 'price_starter_monthly', status = 'active' } = {},
) {
  return {
    id: `evt_${randomUUID()}`,
    type,
    data: {
      object: {
        id: `sub_${randomUUID()}`,
        customer: customerId,
        status,
        items: { data: [{ price: { lookup_key: lookupKey } }] },
      },
    },
  };
}

beforeAll(async () => {
  available = await isLocalStackUp();
  if (!available) return;
  await createTable('tenants');
  const tenantsMod = await import('../../src/repositories/tenants.repo.js');
  tenantsRepo = tenantsMod.tenantsRepo;
  const stripeMod = await import('../../src/services/stripe.service.js');
  stripeService = stripeMod.stripeService;
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

async function seedTenant({ plan = 'free', stripeCustomerId } = {}) {
  const accountId = randomUUID();
  const apiKeyHash = hash(accountId);
  const tenant = await tenantsRepo.create({ accountId, apiKeyHash, stripeCustomerId, plan });
  return tenant;
}

describe('stripe webhook integration', () => {
  beforeEach(async () => {
    if (!available) return;
    await clearTable();
  });

  it.skipIf(!available)('subscription.created sets tenant plan from free to starter', async () => {
    const customerId = `cus_${randomUUID()}`;
    const tenant = await seedTenant({ stripeCustomerId: customerId });
    expect(tenant.plan).toBe('free');

    const event = makeSubscriptionEvent('customer.subscription.created', customerId, {
      lookupKey: 'price_starter_monthly',
    });
    const result = await stripeService.handleSubscriptionEvent(event);

    expect(result.action).toBe('updated');
    expect(result.plan).toBe('starter');

    const updated = await tenantsRepo.getByAccountId(tenant.accountId);
    expect(updated.plan).toBe('starter');
  });

  it.skipIf(!available)('subscription.updated changes plan from starter to growth', async () => {
    const customerId = `cus_${randomUUID()}`;
    const tenant = await seedTenant({ plan: 'starter', stripeCustomerId: customerId });

    const event = makeSubscriptionEvent('customer.subscription.updated', customerId, {
      lookupKey: 'price_growth_monthly',
    });
    const result = await stripeService.handleSubscriptionEvent(event);

    expect(result.action).toBe('updated');
    expect(result.plan).toBe('growth');

    const updated = await tenantsRepo.getByAccountId(tenant.accountId);
    expect(updated.plan).toBe('growth');
  });

  it.skipIf(!available)('subscription.updated upgrades to scale plan', async () => {
    const customerId = `cus_${randomUUID()}`;
    await seedTenant({ plan: 'growth', stripeCustomerId: customerId });

    const event = makeSubscriptionEvent('customer.subscription.updated', customerId, {
      lookupKey: 'price_scale_monthly',
    });
    const result = await stripeService.handleSubscriptionEvent(event);

    expect(result.action).toBe('updated');
    expect(result.plan).toBe('scale');
  });

  it.skipIf(!available)('subscription.deleted downgrades tenant to free', async () => {
    const customerId = `cus_${randomUUID()}`;
    const tenant = await seedTenant({ plan: 'growth', stripeCustomerId: customerId });

    const event = makeSubscriptionEvent('customer.subscription.deleted', customerId);
    const result = await stripeService.handleSubscriptionEvent(event);

    expect(result.action).toBe('downgraded');
    expect(result.plan).toBe('free');

    const updated = await tenantsRepo.getByAccountId(tenant.accountId);
    expect(updated.plan).toBe('free');
  });

  it.skipIf(!available)('ignores unhandled event types', async () => {
    const event = {
      id: `evt_${randomUUID()}`,
      type: 'invoice.payment_succeeded',
      data: { object: {} },
    };
    const result = await stripeService.handleSubscriptionEvent(event);

    expect(result.action).toBe('ignored');
    expect(result.eventType).toBe('invoice.payment_succeeded');
  });

  it.skipIf(!available)('ignores inactive subscription on update', async () => {
    const customerId = `cus_${randomUUID()}`;
    await seedTenant({ stripeCustomerId: customerId });

    const event = makeSubscriptionEvent('customer.subscription.updated', customerId, {
      status: 'past_due',
    });
    const result = await stripeService.handleSubscriptionEvent(event);

    expect(result.action).toBe('ignored');
    expect(result.reason).toContain('past_due');
  });

  it.skipIf(!available)('throws for unknown stripe customer', async () => {
    const event = makeSubscriptionEvent('customer.subscription.created', 'cus_nonexistent');

    await expect(stripeService.handleSubscriptionEvent(event)).rejects.toThrow(
      /No tenant for Stripe customer/,
    );
  });

  it.skipIf(!available)('throws for unknown price lookup_key', async () => {
    const customerId = `cus_${randomUUID()}`;
    await seedTenant({ stripeCustomerId: customerId });

    const event = makeSubscriptionEvent('customer.subscription.updated', customerId, {
      lookupKey: 'price_unknown_tier',
    });

    await expect(stripeService.handleSubscriptionEvent(event)).rejects.toThrow(
      /Unknown price lookup_key/,
    );
  });

  it.skipIf(!available)(
    'full lifecycle: create starter → upgrade growth → cancel free',
    async () => {
      const customerId = `cus_${randomUUID()}`;
      const tenant = await seedTenant({ stripeCustomerId: customerId });

      const createEvt = makeSubscriptionEvent('customer.subscription.created', customerId, {
        lookupKey: 'price_starter_monthly',
      });
      const r1 = await stripeService.handleSubscriptionEvent(createEvt);
      expect(r1).toEqual({ action: 'updated', accountId: tenant.accountId, plan: 'starter' });

      const upgradeEvt = makeSubscriptionEvent('customer.subscription.updated', customerId, {
        lookupKey: 'price_growth_monthly',
      });
      const r2 = await stripeService.handleSubscriptionEvent(upgradeEvt);
      expect(r2).toEqual({ action: 'updated', accountId: tenant.accountId, plan: 'growth' });

      const deleteEvt = makeSubscriptionEvent('customer.subscription.deleted', customerId);
      const r3 = await stripeService.handleSubscriptionEvent(deleteEvt);
      expect(r3).toEqual({ action: 'downgraded', accountId: tenant.accountId, plan: 'free' });

      const final = await tenantsRepo.getByAccountId(tenant.accountId);
      expect(final.plan).toBe('free');
    },
  );

  it.skipIf(!available)('subscription.deleted still downgrades even if already free', async () => {
    const customerId = `cus_${randomUUID()}`;
    const tenant = await seedTenant({ plan: 'free', stripeCustomerId: customerId });

    const event = makeSubscriptionEvent('customer.subscription.deleted', customerId);
    const result = await stripeService.handleSubscriptionEvent(event);

    expect(result.action).toBe('downgraded');
    const updated = await tenantsRepo.getByAccountId(tenant.accountId);
    expect(updated.plan).toBe('free');
  });

  it.skipIf(!available)(
    'concurrent subscription updates for different tenants succeed',
    async () => {
      const cus1 = `cus_${randomUUID()}`;
      const cus2 = `cus_${randomUUID()}`;
      const t1 = await seedTenant({ stripeCustomerId: cus1 });
      const t2 = await seedTenant({ stripeCustomerId: cus2 });

      const [r1, r2] = await Promise.all([
        stripeService.handleSubscriptionEvent(
          makeSubscriptionEvent('customer.subscription.created', cus1, {
            lookupKey: 'price_growth_monthly',
          }),
        ),
        stripeService.handleSubscriptionEvent(
          makeSubscriptionEvent('customer.subscription.created', cus2, {
            lookupKey: 'price_scale_monthly',
          }),
        ),
      ]);

      expect(r1.plan).toBe('growth');
      expect(r2.plan).toBe('scale');

      const u1 = await tenantsRepo.getByAccountId(t1.accountId);
      const u2 = await tenantsRepo.getByAccountId(t2.accountId);
      expect(u1.plan).toBe('growth');
      expect(u2.plan).toBe('scale');
    },
  );
});

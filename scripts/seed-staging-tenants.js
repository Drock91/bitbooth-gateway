#!/usr/bin/env node
// Seeds two staging tenants (A + B) with distinct API keys and routes.
// Used by scripts/smoke/tenant-isolation.js to verify cross-tenant isolation.
//
// Usage:
//   TENANTS_TABLE=x402-tenants-staging ROUTES_TABLE=x402-routes-staging \
//     node scripts/seed-staging-tenants.js
//
// Outputs JSON: { tenantA: { accountId, apiKey }, tenantB: { accountId, apiKey } }

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import crypto from 'node:crypto';

const TENANTS_TABLE = process.env.TENANTS_TABLE || 'x402-tenants-staging';
const ROUTES_TABLE = process.env.ROUTES_TABLE || 'x402-routes-staging';
const REGION = process.env.AWS_REGION || 'us-east-2';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

export async function createTenant(accountId, plan = 'starter') {
  const existing = await ddb.send(new GetCommand({ TableName: TENANTS_TABLE, Key: { accountId } }));
  if (existing.Item) {
    return { accountId, apiKey: null, existed: true };
  }

  const apiKey = `x402_${crypto.randomBytes(24).toString('hex')}`;
  const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const now = new Date().toISOString();

  await ddb.send(
    new PutCommand({
      TableName: TENANTS_TABLE,
      Item: { accountId, apiKeyHash, plan, createdAt: now, updatedAt: now },
    }),
  );
  return { accountId, apiKey, existed: false };
}

export async function seedRoute(tenantId, path, priceWei) {
  const now = new Date().toISOString();
  await ddb.send(
    new PutCommand({
      TableName: ROUTES_TABLE,
      Item: {
        tenantId,
        path,
        priceWei,
        asset: 'USDC',
        createdAt: now,
        updatedAt: now,
      },
    }),
  );
}

export async function seedTenantPair() {
  const idA = process.env.TENANT_A_ID || crypto.randomUUID();
  const idB = process.env.TENANT_B_ID || crypto.randomUUID();

  const tenantA = await createTenant(idA, 'starter');
  const tenantB = await createTenant(idB, 'free');

  await seedRoute(idA, '/v1/resource', '10000');
  await seedRoute(idA, '/v1/fetch', '5000');

  await seedRoute(idB, '/v1/resource', '10000');

  return { tenantA, tenantB };
}

const isMain = process.argv[1]?.endsWith('seed-staging-tenants.js');
if (isMain) {
  try {
    const result = await seedTenantPair();
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('seed failed:', err.message);
    process.exit(1);
  }
}

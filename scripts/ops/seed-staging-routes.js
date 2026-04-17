#!/usr/bin/env node
// Seeds a staging tenant with both /v1/resource and /v1/resource/premium routes.
// Usage: ROUTES_TABLE=x402-routes-staging TENANTS_TABLE=x402-tenants-staging node scripts/ops/seed-staging-routes.js

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import crypto from 'node:crypto';

const ROUTES_TABLE = process.env.ROUTES_TABLE || 'x402-routes-staging';
const TENANTS_TABLE = process.env.TENANTS_TABLE || 'x402-tenants-staging';
const REGION = process.env.AWS_REGION || 'us-east-2';

const BASE_PRICE_WEI = '10000';
const PREMIUM_PRICE_WEI = '20000';
const FETCH_PRICE_WEI = '5000';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

async function ensureTenant(accountId) {
  const res = await ddb.send(new GetCommand({ TableName: TENANTS_TABLE, Key: { accountId } }));
  if (res.Item) {
    console.log(`tenant ${accountId} already exists (plan=${res.Item.plan})`);
    return res.Item;
  }

  const apiKey = `x402_${crypto.randomBytes(24).toString('hex')}`;
  const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const now = new Date().toISOString();

  const item = {
    accountId,
    apiKeyHash,
    plan: 'starter',
    createdAt: now,
    updatedAt: now,
  };

  await ddb.send(new PutCommand({ TableName: TENANTS_TABLE, Item: item }));
  console.log(`created tenant ${accountId} — apiKey=${apiKey}`);
  return item;
}

async function seedRoute(tenantId, path, priceWei) {
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
  console.log(`seeded route ${path} for tenant ${tenantId} (priceWei=${priceWei})`);
}

const accountId = process.env.TENANT_ACCOUNT_ID || crypto.randomUUID();

try {
  await ensureTenant(accountId);
  await seedRoute(accountId, '/v1/resource', BASE_PRICE_WEI);
  await seedRoute(accountId, '/v1/resource/premium', PREMIUM_PRICE_WEI);
  await seedRoute(accountId, '/v1/fetch', FETCH_PRICE_WEI);
  console.log('\ndone — premium route is 2x base price, fetch is $0.005');
} catch (err) {
  console.error('seed failed:', err.message);
  process.exit(1);
}

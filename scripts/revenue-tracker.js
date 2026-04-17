#!/usr/bin/env node
/**
 * revenue-tracker.js — scan DDB payments + tenants tables, compute revenue
 * metrics, emit CloudWatch EMF, send ntfy push for first-402 tenants, and
 * update NORTH_STAR.json.
 *
 * Usage:
 *   node scripts/revenue-tracker.js
 *   node scripts/revenue-tracker.js --dry-run
 *   NTFY_TOPIC=x402-revenue node scripts/revenue-tracker.js
 *
 * Env vars:
 *   AWS_REGION         — default: us-east-2
 *   PAYMENTS_TABLE     — default: x402-payments
 *   TENANTS_TABLE      — default: x402-tenants
 *   NTFY_TOPIC         — ntfy.sh topic for push notifications (optional)
 *   STAGE              — default: staging
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NORTH_STAR_PATH = resolve(__dirname, '../.agent/NORTH_STAR.json');

const PLAN_PRICES = {
  free: 0,
  starter: 49,
  growth: 99,
  scale: 299,
};

export function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--dry-run') args.dryRun = true;
  }
  return args;
}

export function computeMrr(tenants) {
  let mrr = 0;
  let payingCount = 0;
  for (const t of tenants) {
    const price = PLAN_PRICES[t.plan] ?? 0;
    if (price > 0 && (t.status ?? 'active') === 'active') {
      mrr += price;
      payingCount++;
    }
  }
  return { mrr, payingCount };
}

export function computePaymentStats(payments) {
  let lifetimeFetches = 0;
  let lifetimeUsdcMicro = 0;
  const accountFirstSeen = new Map();

  for (const p of payments) {
    if (p.status === 'confirmed') {
      lifetimeUsdcMicro += Number(p.amountWei ?? 0);

      if (p.accountId && !accountFirstSeen.has(p.accountId)) {
        accountFirstSeen.set(p.accountId, p.createdAt);
      }
    }
    if (
      p.status === 'confirmed' &&
      typeof p.idempotencyKey === 'string' &&
      p.idempotencyKey.includes('/v1/fetch')
    ) {
      lifetimeFetches++;
    }
  }

  const lifetimeUsdc = lifetimeUsdcMicro / 1e6;
  return { lifetimeFetches, lifetimeUsdc, accountFirstSeen };
}

export function detectNewFirstPayers(accountFirstSeen, previousCount) {
  return accountFirstSeen.size > previousCount;
}

export function buildEmfMetrics({ mrr, payingCount, lifetimeFetches, lifetimeUsdc }) {
  return {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: 'x402/revenue',
          Dimensions: [[]],
          Metrics: [
            { Name: 'mrr_usd', Unit: 'None' },
            { Name: 'paying_tenants', Unit: 'Count' },
            { Name: 'lifetime_fetches', Unit: 'Count' },
            { Name: 'lifetime_usdc_collected', Unit: 'None' },
          ],
        },
      ],
    },
    mrr_usd: mrr,
    paying_tenants: payingCount,
    lifetime_fetches: lifetimeFetches,
    lifetime_usdc_collected: lifetimeUsdc,
  };
}

export function updateNorthStar(
  northStarPath,
  { mrr, payingCount, lifetimeFetches, lifetimeUsdc },
  { dryRun = false } = {},
) {
  const ns = JSON.parse(readFileSync(northStarPath, 'utf-8'));

  const prev = {
    mrr: ns.mrr_usd ?? 0,
    paying: ns.paying_tenants_count ?? 0,
    fetches: ns.lifetime_fetches ?? 0,
    usdc: ns.lifetime_usdc_collected ?? 0,
  };

  ns.mrr_usd = mrr;
  ns.paying_tenants_count = payingCount;
  ns.lifetime_fetches = lifetimeFetches;
  ns.lifetime_usdc_collected = lifetimeUsdc;
  ns.last_updated = new Date().toISOString();

  if (!dryRun) {
    writeFileSync(northStarPath, JSON.stringify(ns, null, 2) + '\n', 'utf-8');
  }

  return {
    prev,
    current: { mrr, paying: payingCount, fetches: lifetimeFetches, usdc: lifetimeUsdc },
  };
}

export async function sendNtfy(topic, message) {
  if (!topic) return false;
  const res = await fetch(`https://ntfy.sh/${topic}`, {
    method: 'POST',
    headers: { Title: 'x402 Revenue Alert', Priority: '4', Tags: 'money_with_wings' },
    body: message,
  });
  return res.ok;
}

async function scanAll(ddb, tableName) {
  const items = [];
  let lastKey;
  do {
    const params = { TableName: tableName };
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const res = await ddb.send(new ScanCommand(params));
    items.push(...(res.Items ?? []));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

async function main() {
  const args = parseArgs(process.argv);
  const region = process.env.AWS_REGION ?? 'us-east-2';
  const paymentsTable = process.env.PAYMENTS_TABLE ?? 'x402-payments';
  const tenantsTable = process.env.TENANTS_TABLE ?? 'x402-tenants';
  const ntfyTopic = process.env.NTFY_TOPIC;
  const stage = process.env.STAGE ?? 'staging';

  const client = new DynamoDBClient({ region });
  const ddb = DynamoDBDocumentClient.from(client);

  process.stderr.write(`[revenue-tracker] scanning ${stage} tables...\n`);

  const [tenants, payments] = await Promise.all([
    scanAll(ddb, tenantsTable),
    scanAll(ddb, paymentsTable),
  ]);

  process.stderr.write(
    `[revenue-tracker] found ${tenants.length} tenants, ${payments.length} payments\n`,
  );

  const { mrr, payingCount } = computeMrr(tenants);
  const { lifetimeFetches, lifetimeUsdc, accountFirstSeen } = computePaymentStats(payments);

  const emf = buildEmfMetrics({ mrr, payingCount, lifetimeFetches, lifetimeUsdc });
  console.log(JSON.stringify(emf));

  const ns = JSON.parse(readFileSync(NORTH_STAR_PATH, 'utf-8'));
  const previousPayingCount = ns.paying_tenants_count ?? 0;

  if (detectNewFirstPayers(accountFirstSeen, previousPayingCount) && ntfyTopic) {
    const msg = `New paying tenant detected! MRR: $${mrr} | Paying: ${payingCount} | Fetches: ${lifetimeFetches} | USDC: ${lifetimeUsdc.toFixed(6)}`;
    const sent = await sendNtfy(ntfyTopic, msg);
    process.stderr.write(`[revenue-tracker] ntfy ${sent ? 'sent' : 'failed'}: ${msg}\n`);
  }

  const result = updateNorthStar(
    NORTH_STAR_PATH,
    { mrr, payingCount, lifetimeFetches, lifetimeUsdc },
    { dryRun: args.dryRun },
  );

  const tag = args.dryRun ? '[DRY-RUN]' : '[UPDATED]';
  process.stderr.write(`${tag} mrr_usd: $${result.prev.mrr} → $${result.current.mrr}\n`);
  process.stderr.write(`${tag} paying_tenants: ${result.prev.paying} → ${result.current.paying}\n`);
  process.stderr.write(
    `${tag} lifetime_fetches: ${result.prev.fetches} → ${result.current.fetches}\n`,
  );
  process.stderr.write(`${tag} lifetime_usdc: ${result.prev.usdc} → ${result.current.usdc}\n`);

  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`revenue-tracker FAIL: ${err.message}\n`);
    process.exit(1);
  });
}

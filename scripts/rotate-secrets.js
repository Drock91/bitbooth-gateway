#!/usr/bin/env node
// Pre-mainnet secret rotation: flushes all 9 x402 secret entries for a given stage.

import {
  SecretsManagerClient,
  UpdateSecretCommand,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { createHash, randomBytes } from 'node:crypto';

const SECRETS = [
  {
    key: 'agent-wallet',
    generate: () => JSON.stringify({ privateKey: `0x${randomBytes(32).toString('hex')}` }),
    label: 'Agent wallet private key',
  },
  {
    key: 'stripe-webhook',
    generate: () =>
      JSON.stringify({ webhookSecret: `whsec_${randomBytes(24).toString('base64url')}` }),
    label: 'Stripe webhook signing secret',
  },
  {
    key: 'base-rpc',
    generate: () => `https://mainnet.base.org/${randomBytes(16).toString('hex')}`,
    label: 'Base RPC URL',
  },
  {
    key: 'admin-api-key-hash',
    generate: () => {
      const rawKey = randomBytes(32).toString('hex');
      const hash = createHash('sha256').update(rawKey).digest('hex');
      return { secretValue: hash, rawKey };
    },
    label: 'Admin API key hash',
    hasRawKey: true,
  },
  ...['moonpay', 'coinbase', 'kraken', 'binance', 'uphold'].map((name) => ({
    key: `exchanges/${name}`,
    generate: () =>
      JSON.stringify({
        apiKey: randomBytes(24).toString('base64url'),
        webhookSecret: randomBytes(32).toString('base64url'),
      }),
    label: `${name[0].toUpperCase() + name.slice(1)} exchange credentials`,
  })),
];

function parseArgs(argv) {
  const args = argv.slice(2);
  const stage = args.find((a) => a.startsWith('--stage='))?.split('=')[1];
  const execute = args.includes('--execute');
  const dryRun = !execute;

  if (!stage) {
    console.error('[rotate] --stage=<staging|prod> is required');
    process.exit(1);
  }

  const validStages = ['staging', 'prod'];
  if (!validStages.includes(stage)) {
    console.error(`[rotate] invalid stage "${stage}" — must be one of: ${validStages.join(', ')}`);
    process.exit(1);
  }

  return { stage, dryRun, execute };
}

async function verifySecretExists(client, secretId) {
  try {
    await client.send(new GetSecretValueCommand({ SecretId: secretId }));
    return true;
  } catch (err) {
    if (err.name === 'ResourceNotFoundException') return false;
    throw err;
  }
}

async function rotateSecret(client, secretId, newValue) {
  await client.send(
    new UpdateSecretCommand({
      SecretId: secretId,
      SecretString: newValue,
    }),
  );
}

export async function run(argv, deps = {}) {
  const { stage, dryRun } = parseArgs(argv);

  const client = deps.client ?? new SecretsManagerClient({});
  const log = deps.log ?? console.log;
  const logError = deps.logError ?? console.error;

  log(`[rotate] stage: ${stage} | mode: ${dryRun ? 'DRY-RUN' : 'EXECUTE'}`);
  log(`[rotate] rotating ${SECRETS.length} secret entries\n`);

  const results = [];
  const rawKeys = {};

  for (const entry of SECRETS) {
    const secretId = `x402/${stage}/${entry.key}`;

    if (dryRun) {
      log(`[dry-run] would rotate: ${secretId} (${entry.label})`);
      results.push({ secretId, status: 'would-rotate' });
      continue;
    }

    const exists = await verifySecretExists(client, secretId);
    if (!exists) {
      logError(`[rotate] SKIP ${secretId} — not found in Secrets Manager`);
      results.push({ secretId, status: 'not-found' });
      continue;
    }

    const generated = entry.generate();
    const secretValue = entry.hasRawKey ? generated.secretValue : generated;

    if (entry.hasRawKey) {
      rawKeys[entry.key] = generated.rawKey;
    }

    try {
      await rotateSecret(client, secretId, secretValue);
      log(`[rotate] ✓ ${secretId}`);
      results.push({ secretId, status: 'rotated' });
    } catch (err) {
      logError(`[rotate] ✗ ${secretId} — ${err.message}`);
      results.push({ secretId, status: 'error', error: err.message });
    }
  }

  log('');

  if (Object.keys(rawKeys).length > 0) {
    log('[rotate] === SAVE THESE RAW KEYS (shown once) ===');
    for (const [key, value] of Object.entries(rawKeys)) {
      log(`  ${key}: ${value}`);
    }
    log('');
  }

  const rotated = results.filter((r) => r.status === 'rotated').length;
  const skipped = results.filter((r) => r.status === 'not-found').length;
  const errors = results.filter((r) => r.status === 'error').length;
  const dryCount = results.filter((r) => r.status === 'would-rotate').length;

  if (dryRun) {
    log(`[rotate] dry-run complete: ${dryCount} entries would be rotated`);
    log('[rotate] re-run with --execute to apply changes');
  } else {
    log(`[rotate] done: ${rotated} rotated, ${skipped} skipped, ${errors} errors`);
  }

  if (errors > 0) {
    process.exit(1);
  }

  return results;
}

const isDirectRun =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isDirectRun) {
  run(process.argv);
}

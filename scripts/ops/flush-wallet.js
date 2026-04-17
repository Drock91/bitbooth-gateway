#!/usr/bin/env node
// Pre-mainnet agent wallet flush: rotate key, drain balances, archive old key.

import {
  SecretsManagerClient,
  GetSecretValueCommand,
  UpdateSecretCommand,
  CreateSecretCommand,
} from '@aws-sdk/client-secrets-manager';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Wallet, JsonRpcProvider, Contract } from 'ethers';
import { randomBytes } from 'node:crypto';

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

function parseArgs(argv) {
  const args = argv.slice(2);
  const stage = args.find((a) => a.startsWith('--stage='))?.split('=')[1];
  const execute = args.includes('--execute');

  if (!stage) {
    console.error('[flush] --stage=<staging|prod> is required');
    process.exit(1);
  }
  if (!['staging', 'prod'].includes(stage)) {
    console.error(`[flush] invalid stage "${stage}" — must be staging or prod`);
    process.exit(1);
  }
  return { stage, dryRun: !execute };
}

async function fetchSecret(client, secretId) {
  const res = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  return res.SecretString;
}

export async function run(argv, deps = {}) {
  const { stage, dryRun } = parseArgs(argv);

  const smClient = deps.smClient ?? new SecretsManagerClient({});
  const log = deps.log ?? console.log;
  const logError = deps.logError ?? console.error;

  const walletSecretId = `x402/${stage}/agent-wallet`;
  const rpcSecretId = `x402/${stage}/base-rpc`;
  const usdcAddress = process.env.USDC_CONTRACT_ADDRESS ?? BASE_USDC;
  const noncesTable = process.env.AGENT_NONCES_TABLE ?? `x402-agent-nonces-${stage}`;

  const audit = {
    timestamp: new Date().toISOString(),
    stage,
    mode: dryRun ? 'dry-run' : 'execute',
    steps: [],
  };

  function record(step, status, detail = {}) {
    audit.steps.push({ step, status, ...detail });
    const icon = status === 'ok' ? '✓' : status === 'skip' ? '⊘' : '✗';
    log(`[flush] ${icon} ${step}${detail.message ? ` — ${detail.message}` : ''}`);
  }

  log(`[flush] stage: ${stage} | mode: ${dryRun ? 'DRY-RUN' : 'EXECUTE'}`);

  if (dryRun) {
    log('[flush] plan:');
    log(`  1. Load old wallet from ${walletSecretId}`);
    log(`  2. Generate new wallet (random 32-byte key)`);
    log(`  3. Connect to chain via ${rpcSecretId}`);
    log(`  4. Query USDC (${usdcAddress}) + native balances`);
    log('  5. Transfer USDC to new wallet');
    log('  6. Transfer native gas to new wallet');
    log(`  7. Archive old key to ${walletSecretId}-archive-<timestamp>`);
    log(`  8. Update ${walletSecretId} with new key`);
    log(`  9. Initialize nonce in ${noncesTable}`);
    log('');
    log('[flush] dry-run complete — re-run with --execute to apply');
    return audit;
  }

  // Step 1: Load old wallet
  let oldPrivateKey;
  try {
    const raw = await fetchSecret(smClient, walletSecretId);
    oldPrivateKey = JSON.parse(raw).privateKey;
    record('load-old-wallet', 'ok', { message: 'loaded from Secrets Manager' });
  } catch (err) {
    record('load-old-wallet', 'error', { message: err.message });
    logError(`[flush] cannot proceed without old wallet key`);
    process.exit(1);
  }

  // Step 2: Generate new wallet
  const newPrivateKey = `0x${randomBytes(32).toString('hex')}`;
  const createWalletFn = deps.createWallet ?? ((pk) => new Wallet(pk));
  const oldWallet = createWalletFn(oldPrivateKey);
  const newWallet = createWalletFn(newPrivateKey);
  const oldAddress = oldWallet.address;
  const newAddress = newWallet.address;
  record('generate-new-wallet', 'ok', { message: `old=${oldAddress} new=${newAddress}` });

  // Step 3: Connect to chain
  let provider;
  try {
    if (deps.provider) {
      provider = deps.provider;
    } else {
      const rpcUrl = process.env.CHAIN_RPC_URL ?? (await fetchSecret(smClient, rpcSecretId));
      provider = new JsonRpcProvider(rpcUrl);
    }
    record('connect-chain', 'ok');
  } catch (err) {
    record('connect-chain', 'error', { message: err.message });
    logError('[flush] cannot proceed without chain connection');
    process.exit(1);
  }

  const oldSigner = deps.oldSigner ?? oldWallet.connect(provider);

  // Step 4: Query balances
  let usdcBalance = 0n;
  let nativeBalance = 0n;
  try {
    const usdc = deps.usdcContract ?? new Contract(usdcAddress, ERC20_ABI, provider);
    usdcBalance = await usdc.balanceOf(oldAddress);
    nativeBalance = await provider.getBalance(oldAddress);
    record('query-balances', 'ok', {
      message: `USDC=${usdcBalance.toString()} native=${nativeBalance.toString()}`,
    });
  } catch (err) {
    record('query-balances', 'error', { message: err.message });
    logError('[flush] balance query failed — proceeding with key rotation only');
  }

  // Step 5: Transfer USDC
  if (usdcBalance > 0n) {
    try {
      const usdc = deps.usdcContract ?? new Contract(usdcAddress, ERC20_ABI, oldSigner);
      const tx = await usdc.transfer(newAddress, usdcBalance);
      const receipt = await tx.wait();
      record('transfer-usdc', 'ok', {
        message: `${usdcBalance.toString()} → ${newAddress} tx=${receipt.hash}`,
        txHash: receipt.hash,
      });
    } catch (err) {
      record('transfer-usdc', 'error', { message: err.message });
      logError('[flush] USDC transfer failed — old wallet still holds funds');
    }
  } else {
    record('transfer-usdc', 'skip', { message: 'zero balance' });
  }

  // Step 6: Transfer native gas
  if (nativeBalance > 0n) {
    try {
      const gasPrice = await provider.getFeeData();
      const gasLimit = 21000n;
      const gasCost = gasLimit * (gasPrice.gasPrice ?? 0n);
      const sendAmount = nativeBalance - gasCost;
      if (sendAmount > 0n) {
        const tx = await oldSigner.sendTransaction({
          to: newAddress,
          value: sendAmount,
          gasLimit,
        });
        const receipt = await tx.wait();
        record('transfer-native', 'ok', {
          message: `${sendAmount.toString()} → ${newAddress} tx=${receipt.hash}`,
          txHash: receipt.hash,
        });
      } else {
        record('transfer-native', 'skip', { message: 'balance less than gas cost' });
      }
    } catch (err) {
      record('transfer-native', 'error', { message: err.message });
    }
  } else {
    record('transfer-native', 'skip', { message: 'zero balance' });
  }

  // Step 7: Archive old key
  const archiveId = `${walletSecretId}-archive-${audit.timestamp.replace(/[:.]/g, '-')}`;
  try {
    const archivePayload = JSON.stringify({
      privateKey: oldPrivateKey,
      address: oldAddress,
      archivedAt: audit.timestamp,
      replacedBy: newAddress,
    });
    await smClient.send(
      new CreateSecretCommand({
        Name: archiveId,
        SecretString: archivePayload,
        Description: `Archived agent wallet ${oldAddress} replaced by ${newAddress}`,
      }),
    );
    record('archive-old-key', 'ok', { message: archiveId });
  } catch (err) {
    record('archive-old-key', 'error', { message: err.message });
    logError('[flush] CRITICAL: old key not archived — aborting secret update');
    audit.exitCode = 1;
    printAudit(log, audit);
    process.exit(1);
  }

  // Step 8: Update wallet secret
  try {
    await smClient.send(
      new UpdateSecretCommand({
        SecretId: walletSecretId,
        SecretString: JSON.stringify({ privateKey: newPrivateKey }),
      }),
    );
    record('update-wallet-secret', 'ok', { message: `${walletSecretId} → ${newAddress}` });
  } catch (err) {
    record('update-wallet-secret', 'error', { message: err.message });
    logError('[flush] CRITICAL: secret update failed — old key archived, new key NOT active');
    audit.exitCode = 1;
    printAudit(log, audit);
    process.exit(1);
  }

  // Step 9: Initialize nonce
  try {
    const ddbClient = deps.ddbClient ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
    await ddbClient.send(
      new PutCommand({
        TableName: noncesTable,
        Item: {
          walletAddress: newAddress,
          currentNonce: 0,
          lastUsedAt: audit.timestamp,
        },
        ConditionExpression: 'attribute_not_exists(walletAddress)',
      }),
    );
    record('init-nonce', 'ok', { message: `${newAddress} → nonce 0` });
  } catch (err) {
    if (err?.name === 'ConditionalCheckFailedException') {
      record('init-nonce', 'skip', { message: 'nonce entry already exists' });
    } else {
      record('init-nonce', 'error', { message: err.message });
    }
  }

  audit.exitCode = 0;
  audit.summary = {
    oldAddress,
    newAddress,
    usdcDrained: usdcBalance.toString(),
    nativeDrained: nativeBalance.toString(),
    archiveSecretId: archiveId,
  };

  printAudit(log, audit);
  log('');
  log(`[flush] new wallet address: ${newAddress}`);
  log('[flush] done — verify with: node scripts/ops/flush-wallet.js --stage=<stage> (dry-run)');

  return audit;
}

function printAudit(log, audit) {
  log('');
  log('[flush] === AUDIT LOG ===');
  log(JSON.stringify(audit, null, 2));
}

const isDirectRun =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isDirectRun) {
  run(process.argv);
}

#!/usr/bin/env node
/**
 * fetch-smoke.js — nightly smoke test for the /v1/fetch x402 payment flow
 * against the live staging endpoint on Base Sepolia.
 *
 * Flow:
 *   1. POST /v1/fetch with {url} but NO X-PAYMENT → expect 402 challenge
 *   2. Parse challenge (nonce, amountWei, payTo)
 *   3. Read agent wallet private key from Secrets Manager
 *   4. Self-send USDC on Base Sepolia (verifyPayment checks `to`)
 *   5. Wait for 2 confirmations
 *   6. POST /v1/fetch with X-PAYMENT header → expect 200 with {title, markdown, metadata}
 *
 * Env vars (all optional — defaults pull from staging config):
 *   STAGING_URL     — default: live staging API Gateway URL
 *   API_KEY         — default: first real smoke-test tenant API key
 *   ACCOUNT_ID      — default: first real smoke-test tenant account ID
 *   FETCH_TARGET_URL — URL to fetch; default: https://example.com
 *   AWS_REGION      — default: us-east-2
 *   SECRET_ID       — default: x402/staging/agent-wallet
 *   RPC_SECRET_ID   — default: x402/staging/base-rpc
 *   USDC_CONTRACT   — default: Base Sepolia USDC
 */

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { JsonRpcProvider, Wallet, Contract } from 'ethers';
import { fileURLToPath } from 'node:url';

const STAGING_URL =
  process.env.STAGING_URL ?? 'https://x76se73jxd.execute-api.us-east-2.amazonaws.com/staging';
const API_KEY =
  process.env.API_KEY ?? 'x402_28d2dca59241dab4b6fa5ca24d009283ca9f9f32c8866895676a075e52d94f40';
const ACCOUNT_ID = process.env.ACCOUNT_ID ?? 'c2f98f89-73a2-4c45-8cd7-e360fea1a925';
const FETCH_TARGET_URL = process.env.FETCH_TARGET_URL ?? 'https://example.com';
const AWS_REGION = process.env.AWS_REGION ?? 'us-east-2';
const SECRET_ID = process.env.SECRET_ID ?? 'x402/staging/agent-wallet';
const RPC_SECRET_ID = process.env.RPC_SECRET_ID ?? 'x402/staging/base-rpc';
const USDC_CONTRACT = process.env.USDC_CONTRACT ?? '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

const USDC_ABI = ['function transfer(address to, uint256 amount) returns (bool)'];

function stamp(msg) {
  process.stderr.write(`[${new Date().toISOString()}] ${msg}\n`);
}

async function readSecret(secretId) {
  const client = new SecretsManagerClient({ region: AWS_REGION });
  const res = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  return res.SecretString;
}

export async function step1_getChallenge() {
  stamp(`step 1: POST ${STAGING_URL}/v1/fetch without X-PAYMENT`);
  const res = await fetch(`${STAGING_URL}/v1/fetch`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify({ url: FETCH_TARGET_URL }),
  });
  const body = await res.text();
  stamp(`step 1: HTTP ${res.status}`);
  if (res.status !== 402) {
    throw new Error(`expected 402 on first call, got ${res.status}: ${body}`);
  }
  const parsed = JSON.parse(body);
  if (!parsed.challenge?.nonce) {
    throw new Error(`402 response did not include challenge.nonce: ${body}`);
  }
  const ch = parsed.challenge;
  stamp(
    `step 1: challenge received nonce=${ch.nonce.slice(0, 12)}... payTo=${ch.payTo} amountWei=${ch.amountWei}`,
  );
  return ch;
}

export async function step2_selfSendUsdc(challenge) {
  stamp('step 2: reading agent wallet key + rpc url from secrets manager');
  const [walletSecretStr, rpcUrl] = await Promise.all([
    readSecret(SECRET_ID),
    readSecret(RPC_SECRET_ID),
  ]);
  const { privateKey } = JSON.parse(walletSecretStr);

  const provider = new JsonRpcProvider(rpcUrl, Number(challenge.chainId));
  const wallet = new Wallet(privateKey, provider);
  stamp(`step 2: wallet ready ${wallet.address}`);
  if (wallet.address.toLowerCase() !== challenge.payTo.toLowerCase()) {
    stamp(`warning: wallet address ${wallet.address} != challenge.payTo ${challenge.payTo}`);
    throw new Error('wallet address does not match challenge.payTo — self-send would not verify');
  }

  const usdc = new Contract(USDC_CONTRACT, USDC_ABI, wallet);
  stamp(
    `step 2: sending transfer(${wallet.address}, ${challenge.amountWei}) on USDC ${USDC_CONTRACT}`,
  );
  const tx = await usdc.transfer(wallet.address, BigInt(challenge.amountWei));
  stamp(`step 2: tx submitted hash=${tx.hash}`);
  return { tx, wallet, provider };
}

export async function step3_waitConfirmations(tx) {
  const CONFS = 2;
  stamp(`step 3: waiting for ${CONFS} confirmations on ${tx.hash}`);
  const receipt = await tx.wait(CONFS);
  stamp(`step 3: confirmed in block ${receipt.blockNumber} status=${receipt.status}`);
  if (receipt.status !== 1) {
    throw new Error(`tx reverted: ${tx.hash}`);
  }
  return receipt;
}

export async function step4_postWithPayment(challenge, txHash) {
  stamp(`step 4: POST ${STAGING_URL}/v1/fetch with X-PAYMENT header`);
  const xPayment = {
    nonce: challenge.nonce,
    txHash,
    network: `eip155:${challenge.chainId}`,
    signature: 'fetch-smoke-self-send',
  };
  const res = await fetch(`${STAGING_URL}/v1/fetch`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'x-payment': JSON.stringify(xPayment),
    },
    body: JSON.stringify({ url: FETCH_TARGET_URL }),
  });
  const body = await res.text();
  stamp(`step 4: HTTP ${res.status}`);
  if (res.status !== 200) {
    throw new Error(`expected 200 after payment, got ${res.status}: ${body}`);
  }
  const parsed = JSON.parse(body);
  if (!parsed.markdown) {
    throw new Error(`200 response missing markdown field: ${body}`);
  }
  stamp(`step 4: fetched "${parsed.title}" (${parsed.metadata?.contentLength ?? '?'} bytes)`);
  return parsed;
}

async function main() {
  stamp('=== x402 fetch smoke test ===');
  stamp(`staging: ${STAGING_URL}`);
  stamp(`account: ${ACCOUNT_ID}`);
  stamp(`target:  ${FETCH_TARGET_URL}`);

  const challenge = await step1_getChallenge();
  const { tx } = await step2_selfSendUsdc(challenge);
  const receipt = await step3_waitConfirmations(tx);
  const fetchResult = await step4_postWithPayment(challenge, tx.hash);

  stamp('=== SUCCESS ===');
  console.log(
    JSON.stringify(
      {
        ok: true,
        accountId: ACCOUNT_ID,
        resource: '/v1/fetch',
        targetUrl: FETCH_TARGET_URL,
        nonce: challenge.nonce,
        amountWei: challenge.amountWei,
        payTo: challenge.payTo,
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
        fetchedTitle: fetchResult.title,
        fetchedLength: fetchResult.metadata?.contentLength ?? 0,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    stamp(`FAIL: ${err.message}`);
    if (err.stack) stamp(err.stack);
    process.exit(1);
  });
}

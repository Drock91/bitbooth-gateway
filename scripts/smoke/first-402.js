#!/usr/bin/env node
/**
 * first-402.js — end-to-end smoke test for the first real x402 payment flow
 * against the live staging endpoint on Base Sepolia.
 *
 * This script is intended for HOST execution (not the autopilot container)
 * because it needs AWS credentials to read the agent wallet private key
 * from Secrets Manager.
 *
 * Flow:
 *   1. GET challenge: POST /v1/resource with API key but NO X-PAYMENT → expect 402
 *   2. Parse challenge (nonce, amountWei, payTo)
 *   3. Read agent wallet private key from Secrets Manager
 *   4. Self-send USDC on Base Sepolia: agent wallet → agent wallet, amountWei
 *      (verifyPayment only checks `to`, not `from`, so self-send satisfies
 *      the middleware while preserving balance)
 *   5. Wait for 2 confirmations (matches X402_REQUIRED_CONFIRMATIONS=2)
 *   6. POST /v1/resource with X-PAYMENT header containing {nonce, txHash,
 *      signature}
 *   7. Expect 200 + txHash in response body
 *
 * Env vars (all optional — defaults pull from the staging config):
 *   STAGING_URL     — default: live staging API Gateway URL
 *   API_KEY         — default: first real smoke-test tenant API key
 *   ACCOUNT_ID      — default: first real smoke-test tenant account ID
 *   RESOURCE_PATH   — default: /v1/resource
 *   AWS_REGION      — default: us-east-2
 *   SECRET_ID       — default: x402/staging/agent-wallet
 *   RPC_SECRET_ID   — default: x402/staging/base-rpc
 *   USDC_CONTRACT   — default: Base Sepolia USDC 0x036CbD...DCF7e
 */

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { JsonRpcProvider, Wallet, Contract } from 'ethers';

const STAGING_URL =
  process.env.STAGING_URL ?? 'https://x76se73jxd.execute-api.us-east-2.amazonaws.com/staging';
const API_KEY =
  process.env.API_KEY ?? 'x402_28d2dca59241dab4b6fa5ca24d009283ca9f9f32c8866895676a075e52d94f40';
const ACCOUNT_ID = process.env.ACCOUNT_ID ?? 'c2f98f89-73a2-4c45-8cd7-e360fea1a925';
const RESOURCE_PATH = process.env.RESOURCE_PATH ?? '/v1/resource';
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

async function step1_getChallenge() {
  stamp(`step 1: POST ${STAGING_URL}${RESOURCE_PATH} without X-PAYMENT`);
  const res = await fetch(`${STAGING_URL}${RESOURCE_PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify({}),
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
    `step 1: challenge received nonce=${ch.nonce.slice(0, 12)}... payTo=${ch.payTo} amountWei=${ch.amountWei} chainId=${ch.chainId}`,
  );
  return ch;
}

async function step2_selfSendUsdc(challenge) {
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
    stamp('warning: self-send pattern only works if these match — aborting');
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

async function step3_waitConfirmations(tx) {
  const CONFS = 2;
  stamp(`step 3: waiting for ${CONFS} confirmations on ${tx.hash}`);
  const receipt = await tx.wait(CONFS);
  stamp(`step 3: confirmed in block ${receipt.blockNumber} status=${receipt.status}`);
  if (receipt.status !== 1) {
    throw new Error(`tx reverted: ${tx.hash}`);
  }
  return receipt;
}

async function step4_postPayment(challenge, txHash) {
  stamp(`step 4: POST ${STAGING_URL}${RESOURCE_PATH} with X-PAYMENT header`);
  const xPayment = {
    nonce: challenge.nonce,
    txHash,
    signature: 'first-402-smoke-self-send',
  };
  const res = await fetch(`${STAGING_URL}${RESOURCE_PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'x-payment': JSON.stringify(xPayment),
    },
    body: JSON.stringify({}),
  });
  const body = await res.text();
  stamp(`step 4: HTTP ${res.status}`);
  stamp(`step 4: body=${body}`);
  if (res.status !== 200) {
    throw new Error(`expected 200 after payment, got ${res.status}: ${body}`);
  }
  return JSON.parse(body);
}

async function main() {
  stamp('=== x402 first real 402 smoke test ===');
  stamp(`staging: ${STAGING_URL}`);
  stamp(`account: ${ACCOUNT_ID}`);
  stamp(`route:   ${RESOURCE_PATH}`);

  const challenge = await step1_getChallenge();
  const { tx } = await step2_selfSendUsdc(challenge);
  const receipt = await step3_waitConfirmations(tx);
  const paidResponse = await step4_postPayment(challenge, tx.hash);

  stamp('=== SUCCESS ===');
  console.log(
    JSON.stringify(
      {
        ok: true,
        accountId: ACCOUNT_ID,
        resource: RESOURCE_PATH,
        nonce: challenge.nonce,
        amountWei: challenge.amountWei,
        payTo: challenge.payTo,
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
        paidResponse,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  stamp(`FAIL: ${err.message}`);
  if (err.stack) stamp(err.stack);
  process.exit(1);
});

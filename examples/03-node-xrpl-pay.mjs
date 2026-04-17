#!/usr/bin/env node
/**
 * 03 — Pay XRP on XRPL Mainnet (real money, ~$0.003 per call)
 *
 * Cost:    Real XRP. Buy a small amount on any exchange and withdraw to
 *          a Xaman wallet. 5 XRP covers 1000 calls + the wallet reserve.
 *
 * Why XRPL: settles in 3-4 seconds (faster than Base mainnet), and a single
 *          tx costs fractions of a cent vs Base's ~$0.0001 per gas.
 *
 * Note:    @bitbooth/mcp-fetch v1.x ships with EVM signing only. This example
 *          uses xrpl.js directly to demonstrate the protocol works on XRPL —
 *          first-class XRPL support in mcp-fetch is on the roadmap.
 *
 * Run:     XRPL_SEED=s... node examples/03-node-xrpl-pay.mjs
 */

import { Client, Wallet, xrpToDrops } from 'xrpl';

const API = process.env.BITBOOTH_API_URL || 'https://app.heinrichstech.com';
const SEED = process.env.XRPL_SEED;
const URL_TO_FETCH = process.argv[2] || 'https://example.com';

if (!SEED) {
  console.error('Set XRPL_SEED=sXXX (your wallet seed from Xaman, NOT the address)');
  console.error('Cost per fetch: 0.005 XRP (~$0.003)');
  process.exit(1);
}

const wallet = Wallet.fromSeed(SEED);
console.log(`Sending from: ${wallet.address}`);

console.log('\n=== Step 1: get 402 challenge ===');
const r1 = await fetch(`${API}/v1/fetch`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url: URL_TO_FETCH, mode: 'fast' }),
});
const j1 = await r1.json();
const xrpAccept = j1.challenge.accepts.find((a) => a.network === 'xrpl:0' && a.asset === 'XRP');
if (!xrpAccept) throw new Error('Server did not advertise XRPL XRP payment');
console.log(`  nonce:  ${j1.challenge.nonce}`);
console.log(`  payTo:  ${xrpAccept.payTo}`);
console.log(`  amount: ${xrpAccept.amount} drops (${Number(xrpAccept.amount) / 1_000_000} XRP)`);

console.log('\n=== Step 2: send XRP on-chain ===');
const client = new Client('wss://xrplcluster.com');
await client.connect();
const tx = {
  TransactionType: 'Payment',
  Account: wallet.address,
  Destination: xrpAccept.payTo,
  Amount: xrpAccept.amount, // already in drops
};
const submitted = await client.submitAndWait(tx, { wallet });
await client.disconnect();
const txHash = submitted.result.hash;
console.log(`  tx hash:  ${txHash}`);
console.log(`  validated: ${submitted.result.validated}`);

console.log('\n=== Step 3: retry /v1/fetch with X-Payment header ===');
const xPayment = JSON.stringify({
  nonce: j1.challenge.nonce,
  txHash,
  network: 'xrpl:0',
  signature: 'xrpl-onchain-v1',
});
const r2 = await fetch(`${API}/v1/fetch`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-payment': xPayment },
  body: JSON.stringify({ url: URL_TO_FETCH, mode: 'fast' }),
});
const j2 = await r2.json();
console.log(`\n=== TITLE: ${j2.title || '(none)'} ===`);
console.log(j2.markdown.slice(0, 500));
console.log('\nDone. Check earnings: https://app.heinrichstech.com/admin/earnings');

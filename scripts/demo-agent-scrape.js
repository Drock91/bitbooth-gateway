#!/usr/bin/env node

// scripts/demo-agent-scrape.js — CLI demo of an AI agent paying for /v1/fetch
//
// Usage:
//   node scripts/demo-agent-scrape.js                    mock mode (default)
//   node scripts/demo-agent-scrape.js --live              live against BASE_URL
//   node scripts/demo-agent-scrape.js --url https://x.com custom URL to scrape
//
// Env:
//   BASE_URL   server URL for --live (e.g. https://api.bitbooth.io)
//   API_KEY    tenant API key for --live mode

import crypto from 'node:crypto';

const args = process.argv.slice(2);
const LIVE = args.includes('--live');
const urlIdx = args.indexOf('--url');
const TARGET_URL = urlIdx !== -1 && args[urlIdx + 1] ? args[urlIdx + 1] : 'https://example.com';
const BASE_URL = (process.env.BASE_URL || '').replace(/\/+$/, '');
const API_KEY = process.env.API_KEY || '';

const AGENT_ADDR = '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const FETCH_PRICE = '5000';

// ── Output helpers ──────────────────────────────────────────────────

function log(phase, msg) {
  console.log(`  [${phase}] ${msg}`);
}

function hr(title) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'─'.repeat(60)}\n`);
}

function json(obj) {
  console.log('  ' + JSON.stringify(obj, null, 2).replace(/\n/g, '\n  '));
}

function curl(cmd) {
  console.log(`\n  curl equivalent:\n  ${cmd}\n`);
}

// ── Builders ────────────────────────────────────────────────────────

export function buildChallenge(opts = {}) {
  const nonce = opts.nonce || crypto.randomBytes(16).toString('hex');
  return {
    nonce,
    expiresAt: opts.expiresAt || Math.floor(Date.now() / 1000) + 120,
    resource: '/v1/fetch',
    accepts: [
      {
        scheme: 'exact',
        network: 'eip155:8453',
        payTo: AGENT_ADDR,
        asset: `USDC@${USDC_BASE}`,
        amount: FETCH_PRICE,
      },
    ],
    amountWei: FETCH_PRICE,
    assetSymbol: 'USDC',
    payTo: AGENT_ADDR,
    chainId: 8453,
  };
}

export function buildPaymentHeader(nonce, txHash) {
  return {
    nonce,
    txHash: txHash || '0x' + crypto.randomBytes(32).toString('hex'),
    signature: '0x' + crypto.randomBytes(65).toString('hex'),
    network: 'eip155:8453',
  };
}

export function buildFetchResult(url) {
  return {
    title: 'Example Domain',
    markdown:
      '# Example Domain\n\nThis domain is for use in illustrative examples.\n\n[More information...](https://www.iana.org/domains/example)',
    metadata: {
      url: url || TARGET_URL,
      fetchedAt: new Date().toISOString(),
      contentLength: 1256,
      truncated: false,
    },
  };
}

// ── Mock mode ───────────────────────────────────────────────────────

export async function runMock() {
  hr('AI Agent Pay-per-Scrape Demo  (mock mode)');
  console.log('  An AI agent wants to scrape a web page via POST /v1/fetch.');
  console.log('  The endpoint costs $0.005 USDC per request, paid on Base.\n');

  // Step 1 — initial request, get 402 challenge
  hr('Step 1 → POST /v1/fetch (no payment)');
  log('agent', `Scraping ${TARGET_URL} ...`);
  const body = { url: TARGET_URL, mode: 'full' };
  json(body);
  curl(
    `curl -s -X POST http://localhost:3000/v1/fetch \\
    -H "Content-Type: application/json" \\
    -d '${JSON.stringify(body)}'`,
  );

  const challenge = buildChallenge();
  log('server', 'HTTP 402 Payment Required');
  log('server', 'The server says: pay $0.005 USDC on Base to proceed');
  json({ error: { code: 'PAYMENT_REQUIRED' }, challenge });

  // Step 2 — agent pays on-chain
  hr('Step 2 → Agent pays $0.005 USDC on Base');
  const selected = challenge.accepts[0];
  log('agent', `Chain:    ${selected.network}`);
  log('agent', `Amount:   ${selected.amount} (6-decimal USDC = $0.005)`);
  log('agent', `Pay to:   ${selected.payTo}`);
  log('agent', `Asset:    ${selected.asset}`);
  console.log('');

  const txHash = '0x' + crypto.randomBytes(32).toString('hex');
  log('chain', `USDC.transfer() submitted → ${txHash.slice(0, 22)}...`);
  log('chain', 'Confirmed in 2 blocks ✓');

  // Step 3 — retry with X-PAYMENT header
  hr('Step 3 → Retry with payment proof');
  const payment = buildPaymentHeader(challenge.nonce, txHash);
  log('agent', 'Attaching X-PAYMENT header with nonce + txHash');
  json(payment);
  curl(
    `curl -s -X POST http://localhost:3000/v1/fetch \\
    -H "Content-Type: application/json" \\
    -H 'X-PAYMENT: ${JSON.stringify(payment)}' \\
    -d '${JSON.stringify(body)}'`,
  );

  const result = buildFetchResult(TARGET_URL);
  log('server', 'HTTP 200 OK — payment verified, here is your content');
  json(result);

  hr('Summary');
  console.log('  The agent paid $0.005 USDC on Base and received the scraped');
  console.log('  web page as clean markdown — no API key required for payment,');
  console.log('  just a funded wallet and the X-PAYMENT header.');
  console.log('');
  console.log('  This is x402: HTTP 402 Payment Required, for real.');
  console.log('  https://www.x402.org\n');
}

// ── Live mode ───────────────────────────────────────────────────────

export async function runLive() {
  if (!BASE_URL) {
    console.error('  BASE_URL env var required for --live mode');
    console.error(
      '  Example: BASE_URL=https://api.example.com API_KEY=x402_... node scripts/demo-agent-scrape.js --live',
    );
    process.exit(1);
  }

  hr(`AI Agent Pay-per-Scrape Demo  (live: ${BASE_URL})`);

  // Step 1 — get 402 challenge
  hr('Step 1 → POST /v1/fetch (no payment)');
  log('agent', `Scraping ${TARGET_URL} ...`);
  const headers = { 'content-type': 'application/json' };
  if (API_KEY) headers['x-api-key'] = API_KEY;

  const challRes = await fetch(`${BASE_URL}/v1/fetch`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ url: TARGET_URL, mode: 'full' }),
  });
  log('server', `HTTP ${challRes.status}`);

  if (challRes.status !== 402) {
    const text = await challRes.text();
    throw new Error(`expected 402, got ${challRes.status}: ${text.slice(0, 200)}`);
  }

  const challBody = await challRes.json();
  const challenge = challBody.challenge;
  log('server', 'Payment required — challenge received');
  json(challenge);

  curl(
    `curl -s -X POST ${BASE_URL}/v1/fetch \\
    -H "Content-Type: application/json" \\
    ${API_KEY ? `-H "X-API-KEY: ${API_KEY}" \\` : ''}
    -d '{"url":"${TARGET_URL}","mode":"full"}'`,
  );

  // Step 2 — in live mode, agent would pay on-chain here
  hr('Step 2 → Pay on-chain (manual)');
  log('info', 'In a real agent, you would now:');
  log('info', `  1. Send ${challenge.amountWei} USDC to ${challenge.payTo}`);
  log('info', `  2. On chain ${challenge.chainId} (Base)`);
  log('info', '  3. Wait for 2 confirmations');
  log('info', '  4. Re-run with --tx-hash <hash> to complete step 3');
  console.log('');
  log('note', 'Full automated flow available in scripts/smoke/first-402.js');

  hr('Done (manual payment step required for live mode)');
}

// ── Main ────────────────────────────────────────────────────────────

export async function main() {
  if (LIVE) await runLive();
  else await runMock();
}

main().catch((err) => {
  console.error(`\n  Fatal: ${err.message}`);
  process.exit(1);
});

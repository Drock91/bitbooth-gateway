#!/usr/bin/env node
'use strict';

// x402 Pay-per-Fetch Demo
//
// Usage:
//   node demo/run.cjs              mock mode (default)
//   node demo/run.cjs --live       live mode against BASE_URL
//
// Environment:
//   BASE_URL  server URL for --live mode (e.g. https://api.bitbooth.io)

const crypto = require('node:crypto');

const LIVE = process.argv.includes('--live');
const BASE_URL = (process.env.BASE_URL || '').replace(/\/+$/, '');

const MOCK_AGENT_ADDR = '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18';
const MOCK_USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const MOCK_SOL_PAY_TO = '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV';
const MOCK_SOL_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const FETCH_PRICE_WEI = '5000'; // $0.005 USDC (6 decimals)
const DEMO_URL = 'https://example.com';

// ── Formatting helpers ──────────────────────────────────────────────

function log(phase, msg) {
  console.log(`  [${phase}] ${msg}`);
}

function pretty(obj) {
  console.log('  ' + JSON.stringify(obj, null, 2).replace(/\n/g, '\n  '));
}

function hr(title) {
  console.log(`\n  ${'─'.repeat(56)}`);
  console.log(`  ${title}`);
  console.log(`  ${'─'.repeat(56)}\n`);
}

// ── Builders (exported for tests) ───────────────────────────────────

function buildChallenge(opts = {}) {
  const nonce = opts.nonce || crypto.randomBytes(16).toString('hex');
  const expiresAt = opts.expiresAt || Math.floor(Date.now() / 1000) + 120;
  return {
    nonce,
    expiresAt,
    resource: '/v1/fetch',
    accepts: [
      {
        scheme: 'exact',
        network: 'eip155:8453',
        payTo: MOCK_AGENT_ADDR,
        asset: `USDC@${MOCK_USDC_BASE}`,
        amount: FETCH_PRICE_WEI,
      },
      {
        scheme: 'exact',
        network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        payTo: MOCK_SOL_PAY_TO,
        asset: `USDC@${MOCK_SOL_USDC}`,
        amount: FETCH_PRICE_WEI,
      },
    ],
    amountWei: FETCH_PRICE_WEI,
    assetSymbol: 'USDC',
    payTo: MOCK_AGENT_ADDR,
    chainId: 8453,
  };
}

function buildPaymentHeader(nonce, txHash) {
  return {
    nonce,
    txHash: txHash || '0x' + crypto.randomBytes(32).toString('hex'),
    signature: '0x' + crypto.randomBytes(65).toString('hex'),
    network: 'eip155:8453',
  };
}

function buildFetchResult() {
  return {
    title: 'Example Domain',
    markdown: [
      '# Example Domain',
      '',
      'This domain is for use in illustrative examples in documents.',
      'You may use this domain in literature without prior coordination',
      'or asking for permission.',
      '',
      '[More information...](https://www.iana.org/domains/example)',
    ].join('\n'),
    metadata: {
      url: DEMO_URL,
      fetchedAt: new Date().toISOString(),
      contentLength: 1256,
      truncated: false,
    },
  };
}

// ── Mock mode ───────────────────────────────────────────────────────

async function runMock() {
  hr('x402 Pay-per-Fetch Demo  (mock mode)');

  log('setup', 'Agent provisions wallet + API key');
  const apiKey = `x402_${crypto.randomBytes(16).toString('hex')}`;
  log('setup', `API Key:  ${apiKey.slice(0, 16)}...`);
  log('setup', `Route:    POST /v1/fetch  →  $0.005 USDC per scrape`);

  // Step 1 — request without payment → 402 challenge
  hr('Step 1  ▸  Request scrape (no payment)');
  log('req', 'POST /v1/fetch');
  pretty({ url: DEMO_URL, mode: 'full' });
  console.log('');

  const challenge = buildChallenge();
  log('res', 'HTTP 402 Payment Required');
  log('res', 'WWW-Authenticate: X402');
  pretty({ error: { code: 'PAYMENT_REQUIRED' }, challenge });

  // Step 2 — pay via Base USDC
  hr('Step 2  ▸  Pay via Base (USDC)');
  const selected = challenge.accepts[0];
  log('pay', `Chain:    ${selected.network} (Base mainnet)`);
  log('pay', `Amount:   ${selected.amount} wei  ($0.005 USDC)`);
  log('pay', `Pay to:   ${selected.payTo}`);
  log('pay', `Asset:    ${selected.asset}`);
  console.log('');

  const txHash = '0x' + crypto.randomBytes(32).toString('hex');
  log('tx', `Submitted USDC transfer  →  ${txHash.slice(0, 22)}...`);
  log('tx', 'Waiting for 2 block confirmations...');
  log('tx', 'Confirmed at block #28,491,337');

  // Step 3 — retry with X-PAYMENT header
  hr('Step 3  ▸  Retry with payment proof');
  const paymentHeader = buildPaymentHeader(challenge.nonce, txHash);
  log('req', 'POST /v1/fetch');
  log('req', `X-PAYMENT: ${JSON.stringify(paymentHeader).slice(0, 64)}...`);
  pretty({ url: DEMO_URL, mode: 'full' });
  console.log('');

  const result = buildFetchResult();
  log('res', 'HTTP 200 OK');
  pretty(result);

  // Secondary — wallet intel
  hr('Wallet Intel  (secondary)');
  log('wallet', `Address:  ${MOCK_AGENT_ADDR}`);
  log('wallet', 'Chain:    Base (eip155:8453)');
  log('wallet', `USDC:     ${MOCK_USDC_BASE}`);
  log('wallet', 'Balance:  4.995000 USDC');
  log('wallet', 'Nonce:    42');

  hr('Done');
  console.log('  x402 lets AI agents pay for web resources in a single');
  console.log('  HTTP round-trip — no API keys needed for payment,');
  console.log('  just a funded wallet and the X-PAYMENT header.');
  console.log('');
  console.log('  Dual-chain support: Base (EVM) + Solana in one challenge.');
  console.log('  https://www.x402.org\n');
}

// ── Live mode ───────────────────────────────────────────────────────

async function runLive() {
  if (!BASE_URL) {
    console.error('  BASE_URL env var required for --live mode');
    console.error('  Example: BASE_URL=https://api.example.com node demo/run.cjs --live');
    process.exit(1);
  }

  hr(`x402 Pay-per-Fetch Demo  (live: ${BASE_URL})`);

  // Signup
  log('signup', 'POST /dashboard/signup');
  const signupRes = await fetch(`${BASE_URL}/dashboard/signup`, { method: 'POST' });
  if (signupRes.status !== 200) throw new Error(`signup failed: ${signupRes.status}`);
  const html = await signupRes.text();
  const idMatch = html.match(/Account ID:\s*<code>([^<]+)<\/code>/);
  const keyMatch = html.match(/API Key:\s*<code>([^<]+)<\/code>/);
  if (!idMatch || !keyMatch) throw new Error('could not parse signup response');
  const apiKey = keyMatch[1];
  log('signup', `Account:  ${idMatch[1]}`);
  log('signup', `API Key:  ${apiKey.slice(0, 16)}...`);

  // Create paid route
  log('route', 'PUT /dashboard/routes → /v1/resource @ $0.005 USDC');
  const routeRes = await fetch(`${BASE_URL}/dashboard/routes`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ path: '/v1/resource', amountWei: FETCH_PRICE_WEI, assetSymbol: 'USDC' }),
  });
  if (routeRes.status !== 200) throw new Error(`route creation failed: ${routeRes.status}`);

  // Hit /v1/resource → 402 challenge
  hr('Phase 1  ▸  x402 Challenge');
  log('req', 'POST /v1/resource  (no X-PAYMENT)');
  const challRes = await fetch(`${BASE_URL}/v1/resource`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
  });
  log('res', `HTTP ${challRes.status}`);
  if (challRes.status === 402) {
    const body = await challRes.json();
    pretty(body.challenge || body.error);
    log('info', 'Agent would send USDC on-chain and retry with X-PAYMENT');
  } else {
    log('warn', `Expected 402, got ${challRes.status}`);
  }

  // Fetch scrape (API-key auth)
  hr('Phase 2  ▸  Fetch Scrape');
  log('req', `POST /v1/fetch → ${DEMO_URL}`);
  const fetchRes = await fetch(`${BASE_URL}/v1/fetch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ url: DEMO_URL, mode: 'full' }),
  });
  log('res', `HTTP ${fetchRes.status}`);
  if (fetchRes.status === 200) {
    const r = await fetchRes.json();
    log('title', r.title || '(none)');
    console.log('  ' + (r.markdown || '').slice(0, 300).replace(/\n/g, '\n  '));
  } else {
    log('err', (await fetchRes.text()).slice(0, 300));
  }

  // Cleanup
  hr('Cleanup');
  await fetch(`${BASE_URL}/dashboard/routes`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ path: '/v1/resource' }),
  });
  log('done', 'Route deleted');

  hr('Done');
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  if (LIVE) await runLive();
  else await runMock();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`\n  Fatal: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { buildChallenge, buildPaymentHeader, buildFetchResult, runMock, runLive, main };

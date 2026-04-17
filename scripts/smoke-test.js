#!/usr/bin/env node
// Post-deploy smoke test: verifies /v1/health, tenant signup, and x402 challenge against a live stack.

const strict = process.argv.includes('--strict');
const BASE_URL = process.env.SMOKE_BASE_URL;
if (!BASE_URL) {
  console.error('[smoke] SMOKE_BASE_URL env var is required (e.g. https://api.example.com)');
  process.exit(1);
}

const base = BASE_URL.replace(/\/+$/, '');
const results = [];
let apiKey = null;
let accountId = null;

async function run(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    const ms = Date.now() - t0;
    results.push({ name, ok: true, ms });
    console.log(`[smoke] ✓ ${name} (${ms}ms)`);
  } catch (err) {
    const ms = Date.now() - t0;
    results.push({ name, ok: false, ms, error: err.message });
    console.error(`[smoke] ✗ ${name} (${ms}ms): ${err.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

// 1. Basic health check
await run('GET /v1/health', async () => {
  const res = await fetch(`${base}/v1/health`);
  assert(res.status === 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert(body.ok === true, `expected ok=true, got ${JSON.stringify(body)}`);
});

// 2. Deep health check
await run('GET /v1/health/ready', async () => {
  const res = await fetch(`${base}/v1/health/ready`);
  assert(res.status === 200 || res.status === 503, `unexpected status ${res.status}`);
  const body = await res.json();
  assert(typeof body.ok === 'boolean', `expected ok boolean, got ${JSON.stringify(body)}`);
  if (!body.ok) {
    console.warn(`[smoke]   health/ready degraded: ${JSON.stringify(body.checks)}`);
    if (strict) {
      throw new Error(`health/ready degraded in strict mode: ${JSON.stringify(body.checks)}`);
    }
  }
});

// 3. Tenant signup
await run('POST /dashboard/signup', async () => {
  const res = await fetch(`${base}/dashboard/signup`, { method: 'POST' });
  assert(res.status === 200, `expected 200, got ${res.status}`);
  const html = await res.text();
  const idMatch = html.match(/Account ID:\s*<code>([^<]+)<\/code>/);
  assert(idMatch, 'could not find accountId in signup response');
  accountId = idMatch[1];
  const keyMatch = html.match(/API Key:\s*<code>([^<]+)<\/code>/);
  assert(keyMatch, 'could not find apiKey in signup response');
  apiKey = keyMatch[1];
  assert(accountId.length === 36, `accountId looks wrong: ${accountId}`);
  assert(apiKey.length > 0, 'apiKey is empty');
});

// 4. Create a route so x402 challenge can fire
await run('PUT /dashboard/routes', async () => {
  assert(apiKey, 'skipped — no apiKey from signup');
  const res = await fetch(`${base}/dashboard/routes`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      path: '/v1/resource',
      amountWei: '1000000',
      assetSymbol: 'USDC',
    }),
  });
  assert(res.status === 200, `expected 200, got ${res.status} — ${await res.text()}`);
});

// 5. x402 challenge: hit resource without payment, expect 402
await run('POST /v1/resource → 402 challenge', async () => {
  assert(apiKey, 'skipped — no apiKey from signup');
  const res = await fetch(`${base}/v1/resource`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
  });
  assert(res.status === 402, `expected 402, got ${res.status}`);
  const body = await res.json();
  assert(body.error?.nonce, `expected challenge with nonce, got ${JSON.stringify(body)}`);
  assert(body.error?.payTo, `expected challenge with payTo, got ${JSON.stringify(body)}`);
  assert(body.error?.amountWei, `expected challenge with amountWei, got ${JSON.stringify(body)}`);
  assert(
    body.error.amountWei === '1000000',
    `expected base amountWei=1000000, got ${body.error.amountWei}`,
  );
});

// 6. Create premium route at 2x price
await run('PUT /dashboard/routes (premium)', async () => {
  assert(apiKey, 'skipped — no apiKey from signup');
  const res = await fetch(`${base}/dashboard/routes`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      path: '/v1/resource/premium',
      amountWei: '2000000',
      assetSymbol: 'USDC',
    }),
  });
  assert(res.status === 200, `expected 200, got ${res.status} — ${await res.text()}`);
});

// 7. x402 challenge on premium route: verify 2x price
await run('POST /v1/resource/premium → 402 challenge (2x)', async () => {
  assert(apiKey, 'skipped — no apiKey from signup');
  const res = await fetch(`${base}/v1/resource/premium`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
  });
  assert(res.status === 402, `expected 402, got ${res.status}`);
  const body = await res.json();
  assert(body.error?.nonce, `expected challenge with nonce, got ${JSON.stringify(body)}`);
  assert(body.error?.payTo, `expected challenge with payTo, got ${JSON.stringify(body)}`);
  assert(
    body.error?.amountWei === '2000000',
    `expected premium amountWei=2000000, got ${body.error?.amountWei}`,
  );
});

// 8. Cleanup — delete both routes
await run('DELETE /dashboard/routes', async () => {
  assert(apiKey, 'skipped — no apiKey from signup');
  const res = await fetch(`${base}/dashboard/routes`, {
    method: 'DELETE',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({ path: '/v1/resource' }),
  });
  assert(res.status === 200, `expected 200, got ${res.status}`);
});

await run('DELETE /dashboard/routes (premium)', async () => {
  assert(apiKey, 'skipped — no apiKey from signup');
  const res = await fetch(`${base}/dashboard/routes`, {
    method: 'DELETE',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({ path: '/v1/resource/premium' }),
  });
  assert(res.status === 200, `expected 200, got ${res.status}`);
});

// Summary
console.log('\n[smoke] === Results ===');
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).length;
for (const r of results) {
  console.log(
    `[smoke]  ${r.ok ? '✓' : '✗'} ${r.name} (${r.ms}ms)${r.error ? ' — ' + r.error : ''}`,
  );
}
console.log(`[smoke] ${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);

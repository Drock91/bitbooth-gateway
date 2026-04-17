#!/usr/bin/env node
// Cross-tenant isolation smoke test.
// Verifies that Tenant A cannot read Tenant B's payments, routes, or data.
//
// Usage:
//   SMOKE_BASE_URL=https://api.example.com node scripts/smoke/tenant-isolation.js
//
// Pre-requisite: two tenants seeded via scripts/seed-staging-tenants.js,
// or pass API keys directly via TENANT_A_KEY / TENANT_B_KEY env vars.

const BASE_URL = process.env.SMOKE_BASE_URL;
if (!BASE_URL) {
  console.error('[isolation] SMOKE_BASE_URL env var is required');
  process.exit(1);
}

const base = BASE_URL.replace(/\/+$/, '');
const results = [];

let tenantA = { apiKey: null, accountId: null };
let tenantB = { apiKey: null, accountId: null };

async function run(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    const ms = Date.now() - t0;
    results.push({ name, ok: true, ms });
    console.log(`[isolation] ✓ ${name} (${ms}ms)`);
  } catch (err) {
    const ms = Date.now() - t0;
    results.push({ name, ok: false, ms, error: err.message });
    console.error(`[isolation] ✗ ${name} (${ms}ms): ${err.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

// --- Setup: create two tenants via signup ---

async function signupTenant() {
  const res = await fetch(`${base}/dashboard/signup`, { method: 'POST' });
  assert(res.status === 200, `signup expected 200, got ${res.status}`);
  const html = await res.text();
  const idMatch = html.match(/Account ID:\s*<code>([^<]+)<\/code>/);
  assert(idMatch, 'could not find accountId in signup response');
  const keyMatch = html.match(/API Key:\s*<code>([^<]+)<\/code>/);
  assert(keyMatch, 'could not find apiKey in signup response');
  return { accountId: idMatch[1], apiKey: keyMatch[1] };
}

await run('signup tenant A', async () => {
  if (process.env.TENANT_A_KEY && process.env.TENANT_A_ID) {
    tenantA = { apiKey: process.env.TENANT_A_KEY, accountId: process.env.TENANT_A_ID };
  } else {
    tenantA = await signupTenant();
  }
  assert(tenantA.accountId, 'tenant A accountId missing');
  assert(tenantA.apiKey, 'tenant A apiKey missing');
});

await run('signup tenant B', async () => {
  if (process.env.TENANT_B_KEY && process.env.TENANT_B_ID) {
    tenantB = { apiKey: process.env.TENANT_B_KEY, accountId: process.env.TENANT_B_ID };
  } else {
    tenantB = await signupTenant();
  }
  assert(tenantB.accountId, 'tenant B accountId missing');
  assert(tenantB.apiKey, 'tenant B apiKey missing');
  assert(tenantB.accountId !== tenantA.accountId, 'tenants must have different accountIds');
});

// --- Setup: create routes for both tenants ---

await run('create route for tenant A', async () => {
  assert(tenantA.apiKey, 'skipped — no apiKey');
  const res = await fetch(`${base}/dashboard/routes`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${tenantA.apiKey}`,
    },
    body: JSON.stringify({ path: '/v1/resource', amountWei: '1000000', assetSymbol: 'USDC' }),
  });
  assert(res.status === 200, `expected 200, got ${res.status}`);
});

await run('create route for tenant B', async () => {
  assert(tenantB.apiKey, 'skipped — no apiKey');
  const res = await fetch(`${base}/dashboard/routes`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${tenantB.apiKey}`,
    },
    body: JSON.stringify({ path: '/v1/resource', amountWei: '2000000', assetSymbol: 'USDC' }),
  });
  assert(res.status === 200, `expected 200, got ${res.status}`);
});

// --- Isolation test 1: tenant A cannot see tenant B's payments ---

await run('tenant A payments list is empty (no cross-leak)', async () => {
  assert(tenantA.apiKey, 'skipped — no apiKey');
  const res = await fetch(`${base}/v1/payments`, {
    headers: { authorization: `Bearer ${tenantA.apiKey}` },
  });
  assert(res.status === 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert(Array.isArray(body.payments), 'expected payments array');
  const leakedPayments = body.payments.filter((p) => p.accountId === tenantB.accountId);
  assert(
    leakedPayments.length === 0,
    `tenant A sees tenant B payments: ${JSON.stringify(leakedPayments)}`,
  );
});

await run('tenant B payments list is empty (no cross-leak)', async () => {
  assert(tenantB.apiKey, 'skipped — no apiKey');
  const res = await fetch(`${base}/v1/payments`, {
    headers: { authorization: `Bearer ${tenantB.apiKey}` },
  });
  assert(res.status === 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert(Array.isArray(body.payments), 'expected payments array');
  const leakedPayments = body.payments.filter((p) => p.accountId === tenantA.accountId);
  assert(
    leakedPayments.length === 0,
    `tenant B sees tenant A payments: ${JSON.stringify(leakedPayments)}`,
  );
});

// --- Isolation test 2: x402 challenges are tenant-scoped (different prices) ---

await run('tenant A challenge returns correct price', async () => {
  assert(tenantA.apiKey, 'skipped — no apiKey');
  const res = await fetch(`${base}/v1/resource`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${tenantA.apiKey}`,
    },
  });
  assert(res.status === 402, `expected 402, got ${res.status}`);
  const body = await res.json();
  assert(
    body.error?.amountWei === '1000000',
    `tenant A should get 1000000, got ${body.error?.amountWei}`,
  );
});

await run('tenant B challenge returns different price', async () => {
  assert(tenantB.apiKey, 'skipped — no apiKey');
  const res = await fetch(`${base}/v1/resource`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${tenantB.apiKey}`,
    },
  });
  assert(res.status === 402, `expected 402, got ${res.status}`);
  const body = await res.json();
  assert(
    body.error?.amountWei === '2000000',
    `tenant B should get 2000000, got ${body.error?.amountWei}`,
  );
});

// --- Isolation test 3: tenant A cannot read tenant B's routes ---

await run('tenant A routes list does not include tenant B routes', async () => {
  assert(tenantA.apiKey, 'skipped — no apiKey');
  const res = await fetch(`${base}/dashboard/routes`, {
    headers: { authorization: `Bearer ${tenantA.apiKey}` },
  });
  assert(res.status === 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert(Array.isArray(body.routes), 'expected routes array');
  const ownRoutes = body.routes.filter((r) => r.amountWei === '1000000');
  assert(ownRoutes.length >= 1, 'tenant A should see own route');
  const leaked = body.routes.filter((r) => r.amountWei === '2000000');
  assert(leaked.length === 0, `tenant A sees tenant B route price: ${JSON.stringify(leaked)}`);
});

// --- Isolation test 4: tenant B key rejected by tenant A's route management ---

await run('tenant B cannot delete tenant A route', async () => {
  assert(tenantB.apiKey, 'skipped — no apiKey');
  await fetch(`${base}/dashboard/routes`, {
    method: 'DELETE',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${tenantB.apiKey}`,
    },
    body: JSON.stringify({ path: '/v1/resource' }),
  });
  const check = await fetch(`${base}/v1/resource`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${tenantA.apiKey}`,
    },
  });
  assert(
    check.status === 402,
    `tenant A route should still exist after B deletes, got ${check.status}`,
  );
});

// --- Isolation test 5: invalid API key rejected ---

await run('invalid API key returns 401', async () => {
  const res = await fetch(`${base}/v1/payments`, {
    headers: { authorization: 'Bearer x402_invalid_key_000000' },
  });
  assert(res.status === 401, `expected 401 for invalid key, got ${res.status}`);
});

// --- Cleanup ---

await run('cleanup tenant A route', async () => {
  assert(tenantA.apiKey, 'skipped');
  await fetch(`${base}/dashboard/routes`, {
    method: 'DELETE',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${tenantA.apiKey}`,
    },
    body: JSON.stringify({ path: '/v1/resource' }),
  });
});

// Summary
console.log('\n[isolation] === Results ===');
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).length;
for (const r of results) {
  console.log(
    `[isolation]  ${r.ok ? '✓' : '✗'} ${r.name} (${r.ms}ms)${r.error ? ' — ' + r.error : ''}`,
  );
}
console.log(`[isolation] ${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);

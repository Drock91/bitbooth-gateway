#!/usr/bin/env node
/**
 * Local dev server — wraps Lambda handlers in Express so you can
 * see the x402 SaaS dashboard running on localhost:3000.
 *
 * Uses in-memory stores instead of DynamoDB.
 */
import { createServer } from 'node:http';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { renderDashboard } from './lib/templates.js';

const PORT = Number(process.env.PORT ?? 3000);
const MAX_BODY_BYTES = 100 * 1024;

// ── In-memory stores ────────────────────────────────────────────────
const tenants = new Map();
const payments = new Map();
const routes = new Map();

function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}

function tryParseJson(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

// Seed a demo tenant on startup.
const DEMO_KEY = `x402_${randomBytes(32).toString('hex')}`;
const DEMO_ID = randomUUID();
tenants.set(DEMO_ID, {
  accountId: DEMO_ID,
  apiKeyHash: sha256(DEMO_KEY),
  plan: 'free',
  createdAt: new Date().toISOString(),
});

// Seed some demo payments.
for (let i = 0; i < 5; i++) {
  const p = {
    idempotencyKey: randomUUID(),
    accountId: DEMO_ID,
    amountWei: String(Math.floor(Math.random() * 1000000) + 1000),
    assetSymbol: 'USDC',
    status: 'confirmed',
    txHash: `0x${randomBytes(32).toString('hex')}`,
    blockNumber: 10000 + i,
    createdAt: new Date(Date.now() - i * 3600000).toISOString(),
  };
  if (!payments.has(DEMO_ID)) payments.set(DEMO_ID, []);
  payments.get(DEMO_ID).push(p);
}

// ── Auth helper ─────────────────────────────────────────────────────
function authenticate(headers) {
  const key = headers['x-api-key'];
  if (!key) return null;
  const hash = sha256(key);
  for (const t of tenants.values()) {
    if (t.apiKeyHash === hash) return t;
  }
  return null;
}

function getStats() {
  return {
    tenants: tenants.size,
    payments: [...payments.values()].flat().length,
    routes: [...routes.values()].flat().length,
  };
}

const demo = { id: DEMO_ID, key: DEMO_KEY };

// ── Request handler ─────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method;
  const path = url.pathname;

  // Parse body for POST/PUT.
  let body = '';
  if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
    const chunks = [];
    let total = 0;
    let tooLarge = false;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        tooLarge = true;
        break;
      }
      chunks.push(chunk);
    }
    if (tooLarge) {
      res.writeHead(413, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end(JSON.stringify({ error: 'payload too large' }));
      req.destroy();
      return;
    }
    body = Buffer.concat(chunks).toString();
  }

  const headers = req.headers;

  // ── Dashboard HTML ──
  if (path === '/dashboard' && method === 'GET') {
    const accountId = url.searchParams.get('accountId');
    let paymentList = null;
    let tenantRoutes = null;
    let tenant = null;
    if (accountId) {
      paymentList = payments.get(accountId) ?? [];
      tenantRoutes = routes.get(accountId) ?? [];
      tenant = tenants.get(accountId);
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(renderDashboard({ paymentList, tenantRoutes, tenant, demo, stats: getStats() }));
    return;
  }

  // ── Signup ──
  if (path === '/dashboard/signup' && method === 'POST') {
    const accountId = randomUUID();
    const rawApiKey = `x402_${randomBytes(32).toString('hex')}`;
    const apiKeyHash = sha256(rawApiKey);
    tenants.set(accountId, {
      accountId,
      apiKeyHash,
      plan: 'free',
      createdAt: new Date().toISOString(),
    });
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(
      renderDashboard({
        signupResult: { accountId, apiKey: rawApiKey, plan: 'free' },
        demo,
        stats: getStats(),
      }),
    );
    return;
  }

  // ── Rotate key ──
  if (path === '/dashboard/rotate-key' && method === 'POST') {
    const tenant = authenticate(headers);
    if (!tenant) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    const rawApiKey = `x402_${randomBytes(32).toString('hex')}`;
    tenant.apiKeyHash = sha256(rawApiKey);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        accountId: tenant.accountId,
        apiKey: rawApiKey,
        message: 'Key rotated. Save now.',
      }),
    );
    return;
  }

  // ── Put route ──
  if (path === '/dashboard/routes' && method === 'PUT') {
    const tenant = authenticate(headers);
    if (!tenant) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    const data = tryParseJson(body);
    if (!data) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid JSON body' }));
      return;
    }
    if (!routes.has(tenant.accountId)) routes.set(tenant.accountId, []);
    const existing = routes.get(tenant.accountId);
    const idx = existing.findIndex((r) => r.path === data.path);
    const route = { ...data, tenantId: tenant.accountId, createdAt: new Date().toISOString() };
    if (idx >= 0) existing[idx] = route;
    else existing.push(route);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(route));
    return;
  }

  // ── List routes ──
  if (path === '/dashboard/routes' && method === 'GET') {
    const tenant = authenticate(headers);
    if (!tenant) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ routes: routes.get(tenant.accountId) ?? [] }));
    return;
  }

  // ── Delete route ──
  if (path === '/dashboard/routes' && method === 'DELETE') {
    const tenant = authenticate(headers);
    if (!tenant) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    const data = tryParseJson(body);
    if (!data) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid JSON body' }));
      return;
    }
    const existing = routes.get(tenant.accountId) ?? [];
    routes.set(
      tenant.accountId,
      existing.filter((r) => r.path !== data.path),
    );
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── Health ──
  if (path === '/v1/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        stage: 'local',
        tenants: tenants.size,
        payments: [...payments.values()].flat().length,
      }),
    );
    return;
  }

  // ── Payments history ──
  if (path === '/v1/payments' && method === 'GET') {
    const tenant = authenticate(headers);
    if (!tenant) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    const list = payments.get(tenant.accountId) ?? [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ payments: list, nextCursor: null }));
    return;
  }

  // ── Root redirect ──
  if (path === '/') {
    res.writeHead(302, { Location: '/dashboard' });
    res.end();
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, () => {
  console.log(`\n  x402 local dev server`);
  console.log(`  ─────────────────────`);
  console.log(`  Dashboard:  http://localhost:${PORT}/dashboard`);
  console.log(`  Health:     http://localhost:${PORT}/v1/health`);
  console.log(`  API:        http://localhost:${PORT}/v1/payments`);
  console.log(`\n  Demo tenant: ${DEMO_ID}`);
  console.log(`  Demo key:    ${DEMO_KEY}\n`);
});

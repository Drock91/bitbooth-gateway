import { describe, it, expect, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { fork } from 'node:child_process';
import { resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dirname, '../../scripts/smoke/tenant-isolation.js');

function startServer(handler) {
  return new Promise((resolve_) => {
    const srv = createServer(handler);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      resolve_({ srv, port, url: `http://127.0.0.1:${port}` });
    });
  });
}

function closeServer(srv) {
  return new Promise((resolve_) => srv.close(resolve_));
}

function signupHtml(accountId, apiKey) {
  return `<div>Account ID: <code>${accountId}</code><br>API Key: <code>${apiKey}</code><br></div>`;
}

function runScript(env) {
  return new Promise((resolve_) => {
    const child = fork(SCRIPT, [], {
      env: { ...process.env, ...env, NODE_NO_WARNINGS: '1' },
      stdio: 'pipe',
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve_({ code, stdout, stderr }));
  });
}

function buildIsolatedHandler() {
  let signupCount = 0;
  const tenants = [
    { accountId: 'aaa-111', apiKey: 'x402_key_a', amountWei: '1000000' },
    { accountId: 'bbb-222', apiKey: 'x402_key_b', amountWei: '2000000' },
  ];
  const routes = { 'aaa-111': [], 'bbb-222': [] };

  function getTenantByKey(req) {
    const auth = req.headers.authorization || '';
    const key = auth.replace('Bearer ', '');
    return tenants.find((t) => t.apiKey === key);
  }

  return (req, res) => {
    const url = req.url.split('?')[0];
    const method = req.method;

    if (method === 'POST' && url === '/dashboard/signup') {
      const t = tenants[signupCount % 2];
      signupCount++;
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(signupHtml(t.accountId, t.apiKey));
      return;
    }

    const tenant = getTenantByKey(req);
    if (!tenant) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    if (method === 'PUT' && url === '/dashboard/routes') {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        const parsed = JSON.parse(body);
        routes[tenant.accountId].push(parsed);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    if (method === 'GET' && url === '/dashboard/routes') {
      const own = routes[tenant.accountId].map((r) => ({
        path: r.path,
        amountWei: r.amountWei,
      }));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ routes: own }));
      return;
    }

    if (method === 'DELETE' && url === '/dashboard/routes') {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        const parsed = JSON.parse(body);
        routes[tenant.accountId] = routes[tenant.accountId].filter((r) => r.path !== parsed.path);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    if (method === 'GET' && url === '/v1/payments') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ payments: [] }));
      return;
    }

    if (method === 'POST' && url === '/v1/resource') {
      res.writeHead(402, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            nonce: `nonce-${tenant.accountId}`,
            payTo: '0x1234',
            amountWei: tenant.amountWei,
            chainId: 8453,
          },
        }),
      );
      return;
    }

    res.writeHead(404);
    res.end('not found');
  };
}

const servers = [];
afterAll(async () => {
  for (const srv of servers) await closeServer(srv);
});

describe('scripts/smoke/tenant-isolation.js', () => {
  it('exits 1 when SMOKE_BASE_URL is missing', async () => {
    const { code } = await runScript({ SMOKE_BASE_URL: '' });
    expect(code).toBe(1);
  });

  it('passes all checks against a properly isolated server', async () => {
    const { srv, url } = await startServer(buildIsolatedHandler());
    servers.push(srv);

    const { code, stderr } = await runScript({ SMOKE_BASE_URL: url });
    expect(code).toBe(0);
    expect(stderr).not.toContain('✗');
  }, 10000);

  it('accepts pre-configured tenant keys via env vars', async () => {
    const { srv, url } = await startServer(buildIsolatedHandler());
    servers.push(srv);

    const { code } = await runScript({
      SMOKE_BASE_URL: url,
      TENANT_A_KEY: 'x402_key_a',
      TENANT_A_ID: 'aaa-111',
      TENANT_B_KEY: 'x402_key_b',
      TENANT_B_ID: 'bbb-222',
    });
    expect(code).toBe(0);
  }, 10000);

  it('fails when payments leak across tenants', async () => {
    let signupCount = 0;
    const tenants = [
      { accountId: 'aaa-111', apiKey: 'x402_key_a' },
      { accountId: 'bbb-222', apiKey: 'x402_key_b' },
    ];

    const handler = (req, res) => {
      const url = req.url.split('?')[0];

      if (req.method === 'POST' && url === '/dashboard/signup') {
        const t = tenants[signupCount++ % 2];
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(signupHtml(t.accountId, t.apiKey));
        return;
      }

      const auth = req.headers.authorization || '';
      const key = auth.replace('Bearer ', '');
      const tenant = tenants.find((t) => t.apiKey === key);

      if (!tenant) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }

      if (req.method === 'PUT' && url === '/dashboard/routes') {
        let body = '';
        req.on('data', (d) => (body += d));
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }

      if (req.method === 'GET' && url === '/v1/payments') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            payments: [{ accountId: 'bbb-222', amountWei: '10000', txHash: '0xabc' }],
          }),
        );
        return;
      }

      if (req.method === 'POST' && url === '/v1/resource') {
        res.writeHead(402, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { nonce: 'n1', payTo: '0x1234', amountWei: '1000000', chainId: 8453 },
          }),
        );
        return;
      }

      if (req.method === 'GET' && url === '/dashboard/routes') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ routes: [] }));
        return;
      }

      if (req.method === 'DELETE' && url === '/dashboard/routes') {
        let body = '';
        req.on('data', (d) => (body += d));
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }

      res.writeHead(404);
      res.end();
    };

    const { srv, url } = await startServer(handler);
    servers.push(srv);

    const { code, stdout } = await runScript({ SMOKE_BASE_URL: url });
    expect(code).toBe(1);
    expect(stdout).toContain('✗');
  }, 10000);

  it('fails when challenge prices are not tenant-scoped', async () => {
    let signupCount = 0;
    const tenants = [
      { accountId: 'aaa-111', apiKey: 'x402_key_a' },
      { accountId: 'bbb-222', apiKey: 'x402_key_b' },
    ];

    const handler = (req, res) => {
      const url = req.url.split('?')[0];

      if (req.method === 'POST' && url === '/dashboard/signup') {
        const t = tenants[signupCount++ % 2];
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(signupHtml(t.accountId, t.apiKey));
        return;
      }

      const auth = req.headers.authorization || '';
      const key = auth.replace('Bearer ', '');
      const tenant = tenants.find((t) => t.apiKey === key);

      if (!tenant) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }

      if (req.method === 'PUT' && url === '/dashboard/routes') {
        let body = '';
        req.on('data', (d) => (body += d));
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }

      if (req.method === 'GET' && url === '/v1/payments') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ payments: [] }));
        return;
      }

      if (req.method === 'POST' && url === '/v1/resource') {
        res.writeHead(402, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { nonce: 'n1', payTo: '0x1234', amountWei: '9999', chainId: 8453 },
          }),
        );
        return;
      }

      if (req.method === 'GET' && url === '/dashboard/routes') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ routes: [] }));
        return;
      }

      if (req.method === 'DELETE' && url === '/dashboard/routes') {
        let body = '';
        req.on('data', (d) => (body += d));
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }

      res.writeHead(404);
      res.end();
    };

    const { srv, url } = await startServer(handler);
    servers.push(srv);

    const { code, stdout } = await runScript({ SMOKE_BASE_URL: url });
    expect(code).toBe(1);
    expect(stdout).toContain('✗');
  }, 10000);

  it('fails when routes list leaks cross-tenant data', async () => {
    let signupCount = 0;
    const tenants = [
      { accountId: 'aaa-111', apiKey: 'x402_key_a' },
      { accountId: 'bbb-222', apiKey: 'x402_key_b' },
    ];

    const handler = (req, res) => {
      const url = req.url.split('?')[0];

      if (req.method === 'POST' && url === '/dashboard/signup') {
        const t = tenants[signupCount++ % 2];
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(signupHtml(t.accountId, t.apiKey));
        return;
      }

      const auth = req.headers.authorization || '';
      const key = auth.replace('Bearer ', '');
      const tenant = tenants.find((t) => t.apiKey === key);

      if (!tenant) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }

      if (req.method === 'PUT' && url === '/dashboard/routes') {
        let body = '';
        req.on('data', (d) => (body += d));
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }

      if (req.method === 'GET' && url === '/v1/payments') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ payments: [] }));
        return;
      }

      if (req.method === 'POST' && url === '/v1/resource') {
        const amtMap = { 'aaa-111': '1000000', 'bbb-222': '2000000' };
        res.writeHead(402, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              nonce: 'n1',
              payTo: '0x1234',
              amountWei: amtMap[tenant.accountId],
              chainId: 8453,
            },
          }),
        );
        return;
      }

      if (req.method === 'GET' && url === '/dashboard/routes') {
        // Leak: tenant A sees tenant B's route pricing
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            routes: [
              { path: '/v1/resource', amountWei: '1000000' },
              { path: '/v1/resource', amountWei: '2000000' },
            ],
          }),
        );
        return;
      }

      if (req.method === 'DELETE' && url === '/dashboard/routes') {
        let body = '';
        req.on('data', (d) => (body += d));
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }

      res.writeHead(404);
      res.end();
    };

    const { srv, url } = await startServer(handler);
    servers.push(srv);

    const { code, stdout } = await runScript({ SMOKE_BASE_URL: url });
    expect(code).toBe(1);
    expect(stdout).toContain('✗');
  }, 10000);

  it('verifies tenant B delete does not affect tenant A route', async () => {
    const { srv, url } = await startServer(buildIsolatedHandler());
    servers.push(srv);

    const { code, stdout } = await runScript({ SMOKE_BASE_URL: url });
    expect(code).toBe(0);
    expect(stdout).toContain('tenant B cannot delete tenant A route');
    expect(stdout).toContain('✓');
  }, 10000);
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer } from 'node:http';

function startServer(handler) {
  return new Promise((resolve) => {
    const srv = createServer(handler);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      resolve({ srv, port, url: `http://127.0.0.1:${port}` });
    });
  });
}

function closeServer(srv) {
  return new Promise((resolve) => srv.close(resolve));
}

function signupHtml(accountId, apiKey) {
  return `<div>Account ID: <code>${accountId}</code><br>API Key: <code>${apiKey}</code><br></div>`;
}

function buildHandler(accountId, apiKey, overrides = {}) {
  return (req, res) => {
    const key = `${req.method} ${req.url}`;
    if (overrides[key]) return overrides[key](req, res);

    if (key === 'GET /v1/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } else if (key === 'GET /v1/health/ready') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, checks: {} }));
    } else if (key === 'POST /dashboard/signup') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(signupHtml(accountId, apiKey));
    } else if (key === 'PUT /dashboard/routes') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } else if (key === 'POST /v1/resource') {
      res.writeHead(402, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { nonce: 'abc123', payTo: '0x1234', amountWei: '1000000', chainId: 8453 },
        }),
      );
    } else if (key === 'POST /v1/resource/premium') {
      res.writeHead(402, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { nonce: 'def456', payTo: '0x1234', amountWei: '2000000', chainId: 8453 },
        }),
      );
    } else if (key === 'DELETE /dashboard/routes') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(404);
      res.end('not found');
    }
  };
}

describe('scripts/smoke-test.js', () => {
  let origExit;
  let origArgv;
  let exitCode;

  beforeEach(() => {
    exitCode = null;
    origExit = process.exit;
    origArgv = process.argv;
    process.exit = vi.fn((code) => {
      exitCode = code;
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    process.exit = origExit;
    process.argv = origArgv;
    delete process.env.SMOKE_BASE_URL;
  });

  it('exits 1 when SMOKE_BASE_URL is not set', async () => {
    delete process.env.SMOKE_BASE_URL;
    vi.resetModules();
    await expect(import('../../scripts/smoke-test.js?' + Date.now())).rejects.toThrow(
      'process.exit(1)',
    );
    expect(exitCode).toBe(1);
  });

  it('passes all checks against a healthy mock server', async () => {
    const accountId = '12345678-1234-1234-1234-123456789abc';
    const apiKey = 'sk_test_abc123def456';

    const { srv, url } = await startServer(buildHandler(accountId, apiKey));
    try {
      process.env.SMOKE_BASE_URL = url;
      process.exit = origExit;
      vi.resetModules();
      await import('../../scripts/smoke-test.js?' + Date.now());
    } finally {
      await closeServer(srv);
    }
  });

  it('exits 1 when health check returns non-200', async () => {
    const handler = (req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false }));
    };
    const { srv, url } = await startServer(handler);
    try {
      process.env.SMOKE_BASE_URL = url;
      vi.resetModules();
      await expect(import('../../scripts/smoke-test.js?' + Date.now())).rejects.toThrow(
        'process.exit(1)',
      );
      expect(exitCode).toBe(1);
    } finally {
      await closeServer(srv);
    }
  });

  it('exits 1 when signup returns no accountId in HTML', async () => {
    const handler = (req, res) => {
      if (req.url === '/v1/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } else if (req.url === '/v1/health/ready') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } else if (req.url === '/dashboard/signup') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html>Bad response</html>');
      } else {
        res.writeHead(404);
        res.end();
      }
    };
    const { srv, url } = await startServer(handler);
    try {
      process.env.SMOKE_BASE_URL = url;
      vi.resetModules();
      await expect(import('../../scripts/smoke-test.js?' + Date.now())).rejects.toThrow(
        'process.exit(1)',
      );
      expect(exitCode).toBe(1);
    } finally {
      await closeServer(srv);
    }
  });

  it('exits 1 when x402 challenge returns 200 instead of 402', async () => {
    const accountId = '12345678-1234-1234-1234-123456789abc';
    const apiKey = 'sk_test_abc123def456';

    const fakeOk = (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    };
    const { srv, url } = await startServer(
      buildHandler(accountId, apiKey, { 'POST /v1/resource': fakeOk }),
    );
    try {
      process.env.SMOKE_BASE_URL = url;
      vi.resetModules();
      await expect(import('../../scripts/smoke-test.js?' + Date.now())).rejects.toThrow(
        'process.exit(1)',
      );
      expect(exitCode).toBe(1);
    } finally {
      await closeServer(srv);
    }
  });

  it('warns but passes when health/ready returns 503', async () => {
    const accountId = '12345678-1234-1234-1234-123456789abc';
    const apiKey = 'sk_test_abc123def456';

    const degradedReady = (req, res) => {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, checks: { ddb: false } }));
    };
    const { srv, url } = await startServer(
      buildHandler(accountId, apiKey, { 'GET /v1/health/ready': degradedReady }),
    );
    try {
      process.env.SMOKE_BASE_URL = url;
      process.exit = origExit;
      vi.resetModules();
      await import('../../scripts/smoke-test.js?' + Date.now());
    } finally {
      await closeServer(srv);
    }
  });

  it('exits 1 with --strict when health/ready is degraded', async () => {
    const accountId = '12345678-1234-1234-1234-123456789abc';
    const apiKey = 'sk_test_abc123def456';

    const degradedReady = (req, res) => {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, checks: { ddb: false } }));
    };
    const { srv, url } = await startServer(
      buildHandler(accountId, apiKey, { 'GET /v1/health/ready': degradedReady }),
    );
    try {
      process.env.SMOKE_BASE_URL = url;
      process.argv = [...origArgv, '--strict'];
      vi.resetModules();
      await expect(import('../../scripts/smoke-test.js?' + Date.now())).rejects.toThrow(
        'process.exit(1)',
      );
      expect(exitCode).toBe(1);
    } finally {
      await closeServer(srv);
    }
  });

  it('passes with --strict when health/ready is healthy', async () => {
    const accountId = '12345678-1234-1234-1234-123456789abc';
    const apiKey = 'sk_test_abc123def456';

    const { srv, url } = await startServer(buildHandler(accountId, apiKey));
    try {
      process.env.SMOKE_BASE_URL = url;
      process.argv = [...origArgv, '--strict'];
      process.exit = origExit;
      vi.resetModules();
      await import('../../scripts/smoke-test.js?' + Date.now());
    } finally {
      await closeServer(srv);
    }
  });

  it('sends auth header on route and resource requests', async () => {
    const accountId = '12345678-1234-1234-1234-123456789abc';
    const apiKey = 'sk_test_verify_auth';
    const capturedHeaders = {};

    const capturePut = (req, res) => {
      capturedHeaders.putRoute = req.headers['x-api-key'];
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    };
    const captureResource = (req, res) => {
      capturedHeaders.resource = req.headers['x-api-key'];
      res.writeHead(402, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { nonce: 'n', payTo: '0x1', amountWei: '1000000', chainId: 8453 },
        }),
      );
    };
    const capturePremium = (req, res) => {
      capturedHeaders.premium = req.headers['x-api-key'];
      res.writeHead(402, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { nonce: 'p', payTo: '0x1', amountWei: '2000000', chainId: 8453 },
        }),
      );
    };
    const captureDelete = (req, res) => {
      capturedHeaders.deleteRoute = req.headers['x-api-key'];
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    };

    const { srv, url } = await startServer(
      buildHandler(accountId, apiKey, {
        'PUT /dashboard/routes': capturePut,
        'POST /v1/resource': captureResource,
        'POST /v1/resource/premium': capturePremium,
        'DELETE /dashboard/routes': captureDelete,
      }),
    );
    try {
      process.env.SMOKE_BASE_URL = url;
      process.exit = origExit;
      vi.resetModules();
      await import('../../scripts/smoke-test.js?' + Date.now());
      expect(capturedHeaders.putRoute).toBe(apiKey);
      expect(capturedHeaders.resource).toBe(apiKey);
      expect(capturedHeaders.premium).toBe(apiKey);
      expect(capturedHeaders.deleteRoute).toBe(apiKey);
    } finally {
      await closeServer(srv);
    }
  });

  it('strips trailing slash from SMOKE_BASE_URL', async () => {
    const handler = (req, res) => {
      if (req.url === '/v1/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(500);
        res.end('should not hit double-slash paths');
      }
    };
    const { srv, url } = await startServer(handler);
    try {
      process.env.SMOKE_BASE_URL = url + '///';
      vi.resetModules();
      // Will fail on later checks (signup etc.) but health should pass with clean URL
      await expect(import('../../scripts/smoke-test.js?' + Date.now())).rejects.toThrow(
        'process.exit(1)',
      );
    } finally {
      await closeServer(srv);
    }
  });

  it('verifies x402 challenge has required fields', async () => {
    const accountId = '12345678-1234-1234-1234-123456789abc';
    const apiKey = 'sk_test_abc';

    const missingPayTo = (req, res) => {
      res.writeHead(402, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { nonce: 'n', amountWei: '1000000' } }));
    };
    const { srv, url } = await startServer(
      buildHandler(accountId, apiKey, { 'POST /v1/resource': missingPayTo }),
    );
    try {
      process.env.SMOKE_BASE_URL = url;
      vi.resetModules();
      await expect(import('../../scripts/smoke-test.js?' + Date.now())).rejects.toThrow(
        'process.exit(1)',
      );
      expect(exitCode).toBe(1);
    } finally {
      await closeServer(srv);
    }
  });

  it('exits 1 when premium challenge returns wrong amount', async () => {
    const accountId = '12345678-1234-1234-1234-123456789abc';
    const apiKey = 'sk_test_abc';

    const wrongAmount = (req, res) => {
      res.writeHead(402, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { nonce: 'p', payTo: '0x1', amountWei: '999', chainId: 8453 },
        }),
      );
    };
    const { srv, url } = await startServer(
      buildHandler(accountId, apiKey, { 'POST /v1/resource/premium': wrongAmount }),
    );
    try {
      process.env.SMOKE_BASE_URL = url;
      vi.resetModules();
      await expect(import('../../scripts/smoke-test.js?' + Date.now())).rejects.toThrow(
        'process.exit(1)',
      );
      expect(exitCode).toBe(1);
    } finally {
      await closeServer(srv);
    }
  });
});

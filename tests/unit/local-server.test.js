import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const PORT = 9876 + Math.floor(Math.random() * 1000);
let apiKey;

function request(method, path, { body, headers = {} } = {}) {
  return fetch(`http://localhost:${PORT}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
}

beforeAll(async () => {
  process.env.PORT = String(PORT);
  await import('../../src/local-server.js');
  // wait for server to be ready
  await new Promise((r) => setTimeout(r, 200));
  // signup to get an api key
  const res = await request('POST', '/dashboard/signup');
  const html = await res.text();
  const match = html.match(/x402_[a-f0-9]{64}/);
  apiKey = match?.[0];
});

afterAll(() => {
  delete process.env.PORT;
});

describe('local-server JSON parse safety', () => {
  it('PUT /dashboard/routes returns 400 on malformed JSON body', async () => {
    const res = await request('PUT', '/dashboard/routes', {
      body: '{not valid json',
      headers: { 'x-api-key': apiKey },
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('invalid JSON body');
  });

  it('DELETE /dashboard/routes returns 400 on malformed JSON body', async () => {
    const res = await request('DELETE', '/dashboard/routes', {
      body: 'totally broken',
      headers: { 'x-api-key': apiKey },
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('invalid JSON body');
  });

  it('PUT /dashboard/routes returns 401 without api key', async () => {
    const res = await request('PUT', '/dashboard/routes', {
      body: '{}',
    });
    expect(res.status).toBe(401);
  });

  it('DELETE /dashboard/routes returns 401 without api key', async () => {
    const res = await request('DELETE', '/dashboard/routes', {
      body: '{}',
    });
    expect(res.status).toBe(401);
  });

  it('PUT /dashboard/routes succeeds with valid JSON', async () => {
    const res = await request('PUT', '/dashboard/routes', {
      body: JSON.stringify({ path: '/test', priceWei: '1000' }),
      headers: { 'x-api-key': apiKey },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.path).toBe('/test');
  });

  it('DELETE /dashboard/routes succeeds with valid JSON', async () => {
    const res = await request('DELETE', '/dashboard/routes', {
      body: JSON.stringify({ path: '/test' }),
      headers: { 'x-api-key': apiKey },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it('PUT /dashboard/routes returns 400 on empty body', async () => {
    const res = await request('PUT', '/dashboard/routes', {
      body: '',
      headers: { 'x-api-key': apiKey },
    });
    expect(res.status).toBe(400);
  });

  it('DELETE /dashboard/routes returns 400 on empty body', async () => {
    const res = await request('DELETE', '/dashboard/routes', {
      body: '',
      headers: { 'x-api-key': apiKey },
    });
    expect(res.status).toBe(400);
  });
});

describe('local-server edge cases', () => {
  it('GET /dashboard with unknown accountId renders empty state (no crash)', async () => {
    const unknown = '00000000-0000-0000-0000-000000000000';
    const res = await request('GET', `/dashboard?accountId=${unknown}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const html = await res.text();
    expect(html.length).toBeGreaterThan(0);
  });

  it('GET /dashboard with no accountId renders demo state', async () => {
    const res = await request('GET', '/dashboard');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/x402/i);
  });

  it('PUT /dashboard/routes returns 413 when body exceeds 100KB', async () => {
    const oversized = 'x'.repeat(101 * 1024);
    const res = await request('PUT', '/dashboard/routes', {
      body: oversized,
      headers: { 'x-api-key': apiKey },
    });
    expect(res.status).toBe(413);
    const data = await res.json();
    expect(data.error).toBe('payload too large');
  });

  it('POST /dashboard/signup returns 413 when body exceeds 100KB', async () => {
    const oversized = 'y'.repeat(200 * 1024);
    const res = await request('POST', '/dashboard/signup', { body: oversized });
    expect(res.status).toBe(413);
  });

  it('GET /nonexistent returns 404 not found', async () => {
    const res = await request('GET', '/definitely-not-a-route');
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe('not found');
  });

  it('GET /unknown/deep/path returns 404 not found', async () => {
    const res = await request('GET', '/unknown/deep/path');
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe('not found');
  });

  it('GET / redirects to /dashboard', async () => {
    const res = await fetch(`http://localhost:${PORT}/`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/dashboard');
  });

  it('PUT /dashboard/routes accepts valid JSON with malformed content-type', async () => {
    const res = await request('PUT', '/dashboard/routes', {
      body: JSON.stringify({ path: '/ct-test', priceWei: '500' }),
      headers: { 'x-api-key': apiKey, 'Content-Type': 'not/a;real==type' },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.path).toBe('/ct-test');
  });

  it('POST /dashboard/signup ignores bogus content-type header', async () => {
    const res = await request('POST', '/dashboard/signup', {
      headers: { 'Content-Type': 'garbage/nonsense' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
  });

  it('GET /v1/payments without api key returns 401', async () => {
    const res = await request('GET', '/v1/payments');
    expect(res.status).toBe(401);
  });

  it('POST /dashboard/rotate-key without api key returns 401', async () => {
    const res = await request('POST', '/dashboard/rotate-key', { body: '{}' });
    expect(res.status).toBe(401);
  });

  it('GET /v1/health returns stats JSON', async () => {
    const res = await request('GET', '/v1/health');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.stage).toBe('local');
    expect(typeof data.tenants).toBe('number');
  });
});

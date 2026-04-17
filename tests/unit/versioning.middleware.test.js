import { describe, it, expect, vi } from 'vitest';
import { withApiVersion, API_VERSION } from '../../src/middleware/versioning.middleware.js';

function makeEvent(method = 'GET', path = '/v1/health') {
  return { httpMethod: method, path, headers: {} };
}

function makeResponse(status = 200, headers = {}) {
  return { statusCode: status, headers, body: '' };
}

describe('versioning.middleware', () => {
  // --- API_VERSION constant ---

  it('exports API_VERSION as a semver string', () => {
    expect(API_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  // --- X-API-Version header ---

  it('adds x-api-version header to every response', async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse());
    const wrapped = withApiVersion(inner);

    const res = await wrapped(makeEvent());

    expect(res.headers['x-api-version']).toBe(API_VERSION);
  });

  it('preserves existing response headers', async () => {
    const inner = vi
      .fn()
      .mockResolvedValue(
        makeResponse(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }),
      );
    const wrapped = withApiVersion(inner);

    const res = await wrapped(makeEvent());

    expect(res.headers['content-type']).toBe('application/json');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-api-version']).toBe(API_VERSION);
  });

  it('passes event and context through to inner handler', async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse());
    const wrapped = withApiVersion(inner);
    const event = makeEvent('POST', '/v1/quote');
    const ctx = { correlationId: 'test-123' };

    await wrapped(event, ctx);

    expect(inner).toHaveBeenCalledWith(event, ctx);
  });

  it('returns the inner handler response with added header', async () => {
    const body = JSON.stringify({ ok: true });
    const inner = vi.fn().mockResolvedValue({ statusCode: 201, headers: {}, body });
    const wrapped = withApiVersion(inner);

    const res = await wrapped(makeEvent());

    expect(res.statusCode).toBe(201);
    expect(res.body).toBe(body);
  });

  it('works with 4xx/5xx responses', async () => {
    const inner = vi
      .fn()
      .mockResolvedValue(makeResponse(500, { 'content-type': 'application/json' }));
    const wrapped = withApiVersion(inner);

    const res = await wrapped(makeEvent());

    expect(res.statusCode).toBe(500);
    expect(res.headers['x-api-version']).toBe(API_VERSION);
  });

  // --- no deprecations by default ---

  it('does not add deprecation headers when no deprecations configured', async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse());
    const wrapped = withApiVersion(inner);

    const res = await wrapped(makeEvent('GET', '/v1/health'));

    expect(res.headers['deprecation']).toBeUndefined();
    expect(res.headers['sunset']).toBeUndefined();
    expect(res.headers['link']).toBeUndefined();
  });

  it('does not add deprecation headers for non-deprecated routes', async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse());
    const wrapped = withApiVersion(inner, {
      deprecations: { 'GET /v1/old': { sunset: '2026-12-01' } },
    });

    const res = await wrapped(makeEvent('GET', '/v1/health'));

    expect(res.headers['deprecation']).toBeUndefined();
  });

  // --- deprecation headers ---

  it('adds deprecation header for a deprecated route', async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse());
    const wrapped = withApiVersion(inner, {
      deprecations: { 'GET /v1/old': {} },
    });

    const res = await wrapped(makeEvent('GET', '/v1/old'));

    expect(res.headers['deprecation']).toBe('true');
  });

  it('adds sunset header when sunset date is provided', async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse());
    const wrapped = withApiVersion(inner, {
      deprecations: { 'POST /v1/legacy': { sunset: '2026-12-31' } },
    });

    const res = await wrapped(makeEvent('POST', '/v1/legacy'));

    expect(res.headers['deprecation']).toBe('true');
    expect(res.headers['sunset']).toBe('2026-12-31');
  });

  it('adds link header when successor link is provided', async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse());
    const wrapped = withApiVersion(inner, {
      deprecations: { 'GET /v1/old': { link: '/v2/new' } },
    });

    const res = await wrapped(makeEvent('GET', '/v1/old'));

    expect(res.headers['deprecation']).toBe('true');
    expect(res.headers['link']).toBe('</v2/new>; rel="successor-version"');
  });

  it('adds all deprecation headers when both sunset and link provided', async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse());
    const wrapped = withApiVersion(inner, {
      deprecations: { 'DELETE /v1/thing': { sunset: '2026-06-01', link: '/v2/thing' } },
    });

    const res = await wrapped(makeEvent('DELETE', '/v1/thing'));

    expect(res.headers['deprecation']).toBe('true');
    expect(res.headers['sunset']).toBe('2026-06-01');
    expect(res.headers['link']).toBe('</v2/thing>; rel="successor-version"');
    expect(res.headers['x-api-version']).toBe(API_VERSION);
  });

  // --- multiple deprecations ---

  it('supports multiple deprecated routes independently', async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse());
    const deprecations = {
      'GET /v1/alpha': { sunset: '2026-07-01' },
      'POST /v1/beta': { sunset: '2026-08-01', link: '/v2/beta' },
    };
    const wrapped = withApiVersion(inner, { deprecations });

    const res1 = await wrapped(makeEvent('GET', '/v1/alpha'));
    expect(res1.headers['sunset']).toBe('2026-07-01');
    expect(res1.headers['link']).toBeUndefined();

    const res2 = await wrapped(makeEvent('POST', '/v1/beta'));
    expect(res2.headers['sunset']).toBe('2026-08-01');
    expect(res2.headers['link']).toBe('</v2/beta>; rel="successor-version"');
  });

  // --- edge cases ---

  it('works with empty opts object', async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse());
    const wrapped = withApiVersion(inner, {});

    const res = await wrapped(makeEvent());

    expect(res.headers['x-api-version']).toBe(API_VERSION);
    expect(res.headers['deprecation']).toBeUndefined();
  });

  it('does not match partial route keys', async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse());
    const wrapped = withApiVersion(inner, {
      deprecations: { 'GET /v1/health': { sunset: '2026-12-01' } },
    });

    const res = await wrapped(makeEvent('POST', '/v1/health'));

    expect(res.headers['deprecation']).toBeUndefined();
  });

  it('handles response with undefined headers gracefully', async () => {
    const inner = vi.fn().mockResolvedValue({ statusCode: 204, body: '' });
    const wrapped = withApiVersion(inner);

    const res = await wrapped(makeEvent());

    expect(res.headers['x-api-version']).toBe(API_VERSION);
  });
});

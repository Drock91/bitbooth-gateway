import { describe, it, expect, vi } from 'vitest';
import {
  withSecurityHeaders,
  SECURITY_HEADERS,
} from '../../src/middleware/security-headers.middleware.js';

function makeEvent(method = 'GET', path = '/v1/health') {
  return { httpMethod: method, path, headers: {} };
}

function makeResponse(status = 200, headers = {}) {
  return { statusCode: status, headers, body: '' };
}

describe('security-headers.middleware', () => {
  // --- SECURITY_HEADERS constant ---

  it('exports SECURITY_HEADERS with all six required headers', () => {
    expect(SECURITY_HEADERS['content-security-policy']).toContain("default-src 'none'");
    expect(SECURITY_HEADERS['strict-transport-security']).toContain('max-age=');
    expect(SECURITY_HEADERS['x-frame-options']).toBe('DENY');
    expect(SECURITY_HEADERS['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(SECURITY_HEADERS['permissions-policy']).toContain('camera=()');
    expect(SECURITY_HEADERS['access-control-allow-origin']).toBe('*');
  });

  it('CSP header blocks all resource loading and framing', () => {
    const csp = SECURITY_HEADERS['content-security-policy'];
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('HSTS header includes includeSubDomains and preload', () => {
    expect(SECURITY_HEADERS['strict-transport-security']).toContain('includeSubDomains');
    expect(SECURITY_HEADERS['strict-transport-security']).toContain('preload');
  });

  it('permissions-policy restricts camera, microphone, and geolocation', () => {
    const pp = SECURITY_HEADERS['permissions-policy'];
    expect(pp).toContain('camera=()');
    expect(pp).toContain('microphone=()');
    expect(pp).toContain('geolocation=()');
  });

  // --- header injection ---

  it('adds all security headers to every response', async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse());
    const wrapped = withSecurityHeaders(inner);

    const res = await wrapped(makeEvent());

    expect(res.headers['content-security-policy']).toBe(
      SECURITY_HEADERS['content-security-policy'],
    );
    expect(res.headers['strict-transport-security']).toBe(
      SECURITY_HEADERS['strict-transport-security'],
    );
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['permissions-policy']).toBe(SECURITY_HEADERS['permissions-policy']);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('preserves existing response headers', async () => {
    const inner = vi
      .fn()
      .mockResolvedValue(
        makeResponse(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }),
      );
    const wrapped = withSecurityHeaders(inner);

    const res = await wrapped(makeEvent());

    expect(res.headers['content-type']).toBe('application/json');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  it('response headers override security defaults (controller-set headers take precedence)', async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse(200, { 'x-frame-options': 'SAMEORIGIN' }));
    const wrapped = withSecurityHeaders(inner);

    const res = await wrapped(makeEvent());

    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('dashboard HTML CSP overrides the default JSON CSP', async () => {
    const htmlCsp = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'";
    const inner = vi
      .fn()
      .mockResolvedValue(
        makeResponse(200, { 'content-type': 'text/html', 'content-security-policy': htmlCsp }),
      );
    const wrapped = withSecurityHeaders(inner);

    const res = await wrapped(makeEvent('GET', '/dashboard'));

    expect(res.headers['content-security-policy']).toBe(htmlCsp);
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  // --- pass-through ---

  it('passes event and context through to inner handler', async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse());
    const wrapped = withSecurityHeaders(inner);
    const event = makeEvent('POST', '/v1/quote');
    const ctx = { correlationId: 'test-123' };

    await wrapped(event, ctx);

    expect(inner).toHaveBeenCalledWith(event, ctx);
  });

  it('returns the inner handler response unchanged aside from added headers', async () => {
    const body = JSON.stringify({ data: [1, 2, 3] });
    const inner = vi.fn().mockResolvedValue({ statusCode: 201, headers: {}, body });
    const wrapped = withSecurityHeaders(inner);

    const res = await wrapped(makeEvent());

    expect(res.statusCode).toBe(201);
    expect(res.body).toBe(body);
  });

  // --- status code variants ---

  it('adds headers to 4xx responses', async () => {
    const inner = vi
      .fn()
      .mockResolvedValue(makeResponse(404, { 'content-type': 'application/json' }));
    const wrapped = withSecurityHeaders(inner);

    const res = await wrapped(makeEvent());

    expect(res.statusCode).toBe(404);
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('adds headers to 5xx responses', async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse(500));
    const wrapped = withSecurityHeaders(inner);

    const res = await wrapped(makeEvent());

    expect(res.statusCode).toBe(500);
    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  it('adds headers to 402 payment required responses', async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse(402, { 'www-authenticate': 'X402' }));
    const wrapped = withSecurityHeaders(inner);

    const res = await wrapped(makeEvent());

    expect(res.headers['www-authenticate']).toBe('X402');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  // --- edge cases ---

  it('handles response with undefined headers', async () => {
    const inner = vi.fn().mockResolvedValue({ statusCode: 204, body: '' });
    const wrapped = withSecurityHeaders(inner);

    const res = await wrapped(makeEvent());

    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('handles response with null headers', async () => {
    const inner = vi.fn().mockResolvedValue({ statusCode: 200, headers: null, body: '' });
    const wrapped = withSecurityHeaders(inner);

    const res = await wrapped(makeEvent());

    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it('works when composed with other middleware HOFs', async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse(200, { 'x-api-version': '1.0.0' }));
    const outer = vi.fn((fn) => async (event, ctx) => {
      const res = await fn(event, ctx);
      res.headers['x-correlation-id'] = 'abc';
      return res;
    });
    const wrapped = outer(withSecurityHeaders(inner));

    const res = await wrapped(makeEvent());

    expect(res.headers['x-api-version']).toBe('1.0.0');
    expect(res.headers['x-correlation-id']).toBe('abc');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('does not add extra properties to the response object', async () => {
    const original = makeResponse(200, { 'content-type': 'text/html' });
    const inner = vi.fn().mockResolvedValue(original);
    const wrapped = withSecurityHeaders(inner);

    const res = await wrapped(makeEvent());

    expect(res.statusCode).toBe(200);
    expect(Object.keys(res)).toEqual(expect.arrayContaining(['statusCode', 'headers', 'body']));
  });
});

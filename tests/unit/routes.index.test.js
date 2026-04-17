import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('routes/index.js', () => {
  let matchRoute;
  let postQuote;
  let requirePaidResource;
  let getPayments;
  let getHealth;
  let getHealthReady;
  let listTenants;
  let requireBulkResource;
  let postDemoRelay;

  beforeEach(async () => {
    vi.resetModules();

    postQuote = vi.fn().mockResolvedValue({ statusCode: 200 });
    requirePaidResource = vi.fn().mockResolvedValue({ statusCode: 200 });
    requireBulkResource = vi.fn().mockResolvedValue({ statusCode: 200 });
    getPayments = vi.fn().mockResolvedValue({ statusCode: 200 });
    getHealth = vi.fn().mockResolvedValue({ statusCode: 200 });
    getHealthReady = vi.fn().mockResolvedValue({ statusCode: 200 });
    listTenants = vi.fn().mockResolvedValue({ statusCode: 200 });
    postDemoRelay = vi.fn().mockResolvedValue({ statusCode: 200 });

    vi.doMock('../../src/controllers/quote.controller.js', () => ({
      postQuote,
    }));
    vi.doMock('../../src/controllers/payments.controller.js', () => ({
      requirePaidResource,
      requireBulkResource,
      getPayments,
    }));
    vi.doMock('../../src/controllers/health.controller.js', () => ({
      getHealth,
      getHealthReady,
    }));
    vi.doMock('../../src/controllers/admin.controller.js', () => ({
      listTenants,
    }));
    vi.doMock('../../src/controllers/demo-relay.controller.js', () => ({
      postDemoRelay,
    }));
    const mod = await import('../../src/routes/index.js');
    matchRoute = mod.matchRoute;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('matchRoute', () => {
    it('returns postQuote handler for POST /v1/quote', () => {
      const handler = matchRoute({ httpMethod: 'POST', path: '/v1/quote' });
      expect(handler).toBe(postQuote);
    });

    it('returns requirePaidResource handler for POST /v1/resource', () => {
      const handler = matchRoute({ httpMethod: 'POST', path: '/v1/resource' });
      expect(handler).toBe(requirePaidResource);
    });

    it('returns requirePaidResource handler for POST /v1/resource/premium', () => {
      const handler = matchRoute({ httpMethod: 'POST', path: '/v1/resource/premium' });
      expect(handler).toBe(requirePaidResource);
    });

    it('returns getHealth handler for GET /v1/health', () => {
      const handler = matchRoute({ httpMethod: 'GET', path: '/v1/health' });
      expect(handler).toBe(getHealth);
    });

    it('returns undefined for unknown route', () => {
      const handler = matchRoute({ httpMethod: 'GET', path: '/v1/unknown' });
      expect(handler).toBeUndefined();
    });

    it('returns undefined for wrong HTTP method on valid path', () => {
      expect(matchRoute({ httpMethod: 'GET', path: '/v1/quote' })).toBeUndefined();
      expect(matchRoute({ httpMethod: 'DELETE', path: '/v1/resource' })).toBeUndefined();
      expect(matchRoute({ httpMethod: 'POST', path: '/v1/health' })).toBeUndefined();
    });

    it('returns undefined for empty event fields', () => {
      expect(matchRoute({ httpMethod: '', path: '' })).toBeUndefined();
    });

    it('is case-sensitive on method and path', () => {
      expect(matchRoute({ httpMethod: 'post', path: '/v1/quote' })).toBeUndefined();
      expect(matchRoute({ httpMethod: 'POST', path: '/V1/Quote' })).toBeUndefined();
    });

    it('does not match paths with trailing slashes', () => {
      expect(matchRoute({ httpMethod: 'POST', path: '/v1/quote/' })).toBeUndefined();
      expect(matchRoute({ httpMethod: 'GET', path: '/v1/health/' })).toBeUndefined();
    });

    it('does not match paths with query strings appended', () => {
      expect(matchRoute({ httpMethod: 'POST', path: '/v1/quote?foo=bar' })).toBeUndefined();
    });

    it('returns getPayments handler for GET /v1/payments', () => {
      const handler = matchRoute({ httpMethod: 'GET', path: '/v1/payments' });
      expect(handler).toBe(getPayments);
    });

    it('returns getHealthReady handler for GET /v1/health/ready', () => {
      const handler = matchRoute({ httpMethod: 'GET', path: '/v1/health/ready' });
      expect(handler).toBe(getHealthReady);
    });

    it('returns listTenants handler for GET /admin/tenants', () => {
      const handler = matchRoute({ httpMethod: 'GET', path: '/admin/tenants' });
      expect(handler).toBe(listTenants);
    });

    it('returns requireBulkResource handler for POST /v1/resource/bulk', () => {
      const handler = matchRoute({ httpMethod: 'POST', path: '/v1/resource/bulk' });
      expect(handler).toBe(requireBulkResource);
    });

    it('does NOT route /v1/fetch on api.js (it has its own fetchFn handler)', () => {
      expect(matchRoute({ httpMethod: 'POST', path: '/v1/fetch' })).toBeUndefined();
      expect(matchRoute({ httpMethod: 'GET', path: '/v1/fetch' })).toBeUndefined();
    });

    it('returns postDemoRelay handler for POST /v1/demo/relay', () => {
      const handler = matchRoute({ httpMethod: 'POST', path: '/v1/demo/relay' });
      expect(handler).toBe(postDemoRelay);
    });
  });

  describe('GET /v1/health handler', () => {
    it('delegates to getHealth controller', () => {
      const handler = matchRoute({ httpMethod: 'GET', path: '/v1/health' });
      expect(handler).toBe(getHealth);
    });
  });

  describe('route table completeness', () => {
    it('has exactly 9 registered routes', () => {
      const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];
      const paths = [
        '/v1/quote',
        '/v1/resource',
        '/v1/resource/premium',
        '/v1/resource/bulk',
        '/v1/fetch',
        '/v1/health',
        '/v1/health/ready',
        '/v1/payments',
        '/v1/demo/relay',
        '/admin/tenants',
        '/v1/pay',
        '/v2/quote',
      ];
      let matchCount = 0;

      for (const m of methods) {
        for (const p of paths) {
          if (matchRoute({ httpMethod: m, path: p })) matchCount++;
        }
      }

      expect(matchCount).toBe(9);
    });
  });
});

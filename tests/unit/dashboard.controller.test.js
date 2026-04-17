import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSignup = vi.fn();
const mockRotateKey = vi.fn();
const mockGetRecentPayments = vi.fn();
const mockUpsertRoute = vi.fn();
const mockRemoveRoute = vi.fn();
const mockListRoutes = vi.fn();
const mockAuthenticate = vi.fn();
const mockRouteCreated = vi.fn();
const mockRouteDeleted = vi.fn();
const mockApiKeyRotated = vi.fn();
const mockEnforceSignupRateLimit = vi.fn();

vi.mock('../../src/services/dashboard.service.js', () => ({
  dashboardService: {
    signup: (...args) => mockSignup(...args),
    rotateKey: (...args) => mockRotateKey(...args),
    getRecentPayments: (...args) => mockGetRecentPayments(...args),
    upsertRoute: (...args) => mockUpsertRoute(...args),
    removeRoute: (...args) => mockRemoveRoute(...args),
    listRoutes: (...args) => mockListRoutes(...args),
  },
}));
vi.mock('../../src/middleware/auth.middleware.js', () => ({
  authenticate: (...args) => mockAuthenticate(...args),
}));
vi.mock('../../src/lib/metrics.js', () => ({
  routeCreated: (...args) => mockRouteCreated(...args),
  routeDeleted: (...args) => mockRouteDeleted(...args),
  apiKeyRotated: (...args) => mockApiKeyRotated(...args),
}));
vi.mock('../../src/middleware/rate-limit.middleware.js', () => ({
  enforceSignupRateLimit: (...args) => mockEnforceSignupRateLimit(...args),
  extractClientIp: (event) =>
    event?.requestContext?.identity?.sourceIp ??
    event?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ??
    'unknown',
  rateLimitHeaders: (info) => ({
    'ratelimit-limit': String(info.limit),
    'ratelimit-remaining': String(info.remaining),
    'ratelimit-reset': String(info.reset),
  }),
}));

import {
  getDashboard,
  postSignup,
  postRotateKey,
  putRoute,
  deleteRoute,
  getRoutes,
} from '../../src/controllers/dashboard.controller.js';
import { AppError, UnauthorizedError, ValidationError } from '../../src/lib/errors.js';

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

describe('dashboard.controller', () => {
  beforeEach(() => {
    mockSignup.mockReset();
    mockRotateKey.mockReset();
    mockGetRecentPayments.mockReset();
    mockUpsertRoute.mockReset();
    mockRemoveRoute.mockReset();
    mockListRoutes.mockReset();
    mockAuthenticate.mockReset();
    mockRouteCreated.mockReset();
    mockRouteDeleted.mockReset();
    mockApiKeyRotated.mockReset();
    mockEnforceSignupRateLimit.mockReset();
    mockEnforceSignupRateLimit.mockResolvedValue({ limit: 5, remaining: 4, reset: 720 });
  });

  describe('getDashboard', () => {
    it('returns 200 HTML without payments when no accountId', async () => {
      const res = await getDashboard({ queryStringParameters: {} });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(res.body).toContain('x402 Dashboard');
      expect(res.body).not.toContain('<table>');
    });

    it('returns 200 when queryStringParameters is null', async () => {
      const res = await getDashboard({ queryStringParameters: null });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('x402 Dashboard');
    });

    it('fetches and displays payments when valid UUID accountId is provided', async () => {
      const payments = [
        {
          idempotencyKey: 'nonce-1',
          amountWei: '500000',
          assetSymbol: 'USDC',
          status: 'confirmed',
          txHash: '0xabc',
          createdAt: '2026-04-05T12:00:00.000Z',
        },
      ];
      mockGetRecentPayments.mockResolvedValueOnce(payments);

      const res = await getDashboard({
        queryStringParameters: { accountId: VALID_UUID },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('nonce-1');
      expect(res.body).toContain('0xabc');
      expect(res.body).toContain('500000');
      expect(mockGetRecentPayments).toHaveBeenCalledWith(VALID_UUID);
    });

    it('shows empty table when account has no payments', async () => {
      mockGetRecentPayments.mockResolvedValueOnce([]);
      const res = await getDashboard({
        queryStringParameters: { accountId: VALID_UUID },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('No payments found');
    });

    it('returns 400 when accountId is not a valid UUID', async () => {
      const res = await getDashboard({
        queryStringParameters: { accountId: 'not-a-uuid' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('Invalid account ID format');
      expect(mockGetRecentPayments).not.toHaveBeenCalled();
    });

    it('returns 400 for SQL injection attempt in accountId', async () => {
      const res = await getDashboard({
        queryStringParameters: { accountId: "'; DROP TABLE payments;--" },
      });
      expect(res.statusCode).toBe(400);
      expect(mockGetRecentPayments).not.toHaveBeenCalled();
    });

    it('renders payment rows with null fields as empty strings', async () => {
      const payments = [
        {
          idempotencyKey: null,
          amountWei: undefined,
          assetSymbol: null,
          status: undefined,
          txHash: null,
          createdAt: undefined,
        },
      ];
      mockGetRecentPayments.mockResolvedValueOnce(payments);

      const res = await getDashboard({
        queryStringParameters: { accountId: VALID_UUID },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('<table>');
    });

    it('includes CSP header in response', async () => {
      const res = await getDashboard({ queryStringParameters: {} });
      expect(res.headers['content-security-policy']).toBe(
        "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      );
    });

    it('includes x-content-type-options header', async () => {
      const res = await getDashboard({ queryStringParameters: {} });
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('escapes HTML in payment fields', async () => {
      const payments = [
        {
          idempotencyKey: '<script>alert(1)</script>',
          amountWei: '100',
          assetSymbol: 'USDC',
          status: 'confirmed',
          txHash: '0x1',
          createdAt: '2026-04-05T00:00:00.000Z',
        },
      ];
      mockGetRecentPayments.mockResolvedValueOnce(payments);

      const res = await getDashboard({
        queryStringParameters: { accountId: VALID_UUID },
      });
      expect(res.body).not.toContain('<script>');
      expect(res.body).toContain('&lt;script&gt;');
    });
  });

  describe('postSignup', () => {
    const signupEvent = { requestContext: { identity: { sourceIp: '1.2.3.4' } }, headers: {} };

    it('returns 200 with account details on success', async () => {
      mockSignup.mockResolvedValueOnce({
        accountId: VALID_UUID,
        apiKey: 'x402_abc123',
        plan: 'free',
      });

      const res = await postSignup(signupEvent);
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('Account created');
      expect(res.body).toContain(VALID_UUID);
      expect(res.body).toContain('x402_abc123');
    });

    it('returns error status on AppError', async () => {
      const err = new AppError('CONFLICT', 'Tenant already exists', 409);
      mockSignup.mockRejectedValueOnce(err);

      const res = await postSignup(signupEvent);
      expect(res.statusCode).toBe(409);
      expect(res.body).toContain('Tenant already exists');
    });

    it('returns 500 on unexpected error', async () => {
      mockSignup.mockRejectedValueOnce(new Error('network'));
      const res = await postSignup(signupEvent);
      expect(res.statusCode).toBe(500);
      expect(res.body).toContain('Signup failed');
    });

    it('includes CSP header on signup response', async () => {
      mockSignup.mockResolvedValueOnce({
        accountId: VALID_UUID,
        apiKey: 'x402_key',
        plan: 'free',
      });
      const res = await postSignup(signupEvent);
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    });

    it('includes CSP header on signup error response', async () => {
      mockSignup.mockRejectedValueOnce(new Error('fail'));
      const res = await postSignup(signupEvent);
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    });

    it('enforces signup rate limit with client IP', async () => {
      mockSignup.mockResolvedValueOnce({ accountId: VALID_UUID, apiKey: 'x402_k', plan: 'free' });
      await postSignup(signupEvent);
      expect(mockEnforceSignupRateLimit).toHaveBeenCalledWith('1.2.3.4');
    });

    it('includes ratelimit headers on success', async () => {
      mockSignup.mockResolvedValueOnce({ accountId: VALID_UUID, apiKey: 'x402_k', plan: 'free' });
      const res = await postSignup(signupEvent);
      expect(res.headers['ratelimit-limit']).toBe('5');
      expect(res.headers['ratelimit-remaining']).toBe('4');
      expect(res.headers['ratelimit-reset']).toBe('720');
    });

    it('returns 429 when signup rate limit exhausted', async () => {
      const { TooManyRequestsError } = await import('../../src/lib/errors.js');
      mockEnforceSignupRateLimit.mockRejectedValueOnce(new TooManyRequestsError(720, 5));

      const res = await postSignup(signupEvent);
      expect(res.statusCode).toBe(429);
      expect(res.body).toContain('Too many requests');
    });

    it('extracts IP from x-forwarded-for when sourceIp absent', async () => {
      mockSignup.mockResolvedValueOnce({ accountId: VALID_UUID, apiKey: 'x402_k', plan: 'free' });
      const event = { headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' } };
      await postSignup(event);
      expect(mockEnforceSignupRateLimit).toHaveBeenCalledWith('10.0.0.1');
    });

    it('uses "unknown" when no IP info available', async () => {
      mockSignup.mockResolvedValueOnce({ accountId: VALID_UUID, apiKey: 'x402_k', plan: 'free' });
      await postSignup({});
      expect(mockEnforceSignupRateLimit).toHaveBeenCalledWith('unknown');
    });
  });

  describe('postRotateKey', () => {
    it('returns 200 JSON with new API key on success', async () => {
      mockAuthenticate.mockResolvedValueOnce({ accountId: VALID_UUID, plan: 'free' });
      mockRotateKey.mockResolvedValueOnce({ accountId: VALID_UUID, apiKey: 'x402_newkey' });

      const res = await postRotateKey({ headers: { 'x-api-key': 'old-key' } });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.accountId).toBe(VALID_UUID);
      expect(body.apiKey).toBe('x402_newkey');
      expect(body.message).toContain('rotated');
    });

    it('returns JSON content-type', async () => {
      mockAuthenticate.mockResolvedValueOnce({ accountId: VALID_UUID, plan: 'free' });
      mockRotateKey.mockResolvedValueOnce({ accountId: VALID_UUID, apiKey: 'x402_k' });

      const res = await postRotateKey({ headers: { 'x-api-key': 'k' } });
      expect(res.headers['content-type']).toBe('application/json');
    });

    it('authenticates with event headers', async () => {
      mockAuthenticate.mockResolvedValueOnce({ accountId: VALID_UUID, plan: 'free' });
      mockRotateKey.mockResolvedValueOnce({ accountId: VALID_UUID, apiKey: 'x402_k' });

      const headers = { 'x-api-key': 'my-key' };
      await postRotateKey({ headers });
      expect(mockAuthenticate).toHaveBeenCalledWith(headers);
    });

    it('passes accountId from auth to service', async () => {
      mockAuthenticate.mockResolvedValueOnce({ accountId: VALID_UUID, plan: 'starter' });
      mockRotateKey.mockResolvedValueOnce({ accountId: VALID_UUID, apiKey: 'x402_k' });

      await postRotateKey({ headers: { 'x-api-key': 'k' } });
      expect(mockRotateKey).toHaveBeenCalledWith(VALID_UUID);
    });

    it('throws UnauthorizedError when auth fails', async () => {
      mockAuthenticate.mockRejectedValueOnce(new UnauthorizedError('invalid api key'));
      await expect(postRotateKey({ headers: {} })).rejects.toThrow('invalid api key');
    });

    it('emits apiKey.rotated metric on success', async () => {
      mockAuthenticate.mockResolvedValueOnce({ accountId: VALID_UUID, plan: 'free' });
      mockRotateKey.mockResolvedValueOnce({ accountId: VALID_UUID, apiKey: 'x402_k2' });

      await postRotateKey({ headers: { 'x-api-key': 'k' } });
      expect(mockApiKeyRotated).toHaveBeenCalledWith({ accountId: VALID_UUID });
    });

    it('propagates service errors', async () => {
      mockAuthenticate.mockResolvedValueOnce({ accountId: VALID_UUID, plan: 'free' });
      mockRotateKey.mockRejectedValueOnce(new Error('ddb down'));
      await expect(postRotateKey({ headers: { 'x-api-key': 'k' } })).rejects.toThrow('ddb down');
    });

    it('handles null headers gracefully', async () => {
      mockAuthenticate.mockResolvedValueOnce({ accountId: VALID_UUID, plan: 'free' });
      mockRotateKey.mockResolvedValueOnce({ accountId: VALID_UUID, apiKey: 'x402_k' });

      const res = await postRotateKey({ headers: null });
      expect(res.statusCode).toBe(200);
      expect(mockAuthenticate).toHaveBeenCalledWith({});
    });
  });

  describe('putRoute', () => {
    const validBody = { path: '/v1/data', priceWei: '1000000', asset: 'USDC' };
    const routeResult = {
      tenantId: VALID_UUID,
      path: '/v1/data',
      priceWei: '1000000',
      asset: 'USDC',
      createdAt: '2026-04-06T00:00:00.000Z',
      updatedAt: '2026-04-06T00:00:00.000Z',
    };

    it('returns 200 with route on success', async () => {
      mockAuthenticate.mockResolvedValueOnce({ accountId: VALID_UUID, plan: 'free' });
      mockUpsertRoute.mockResolvedValueOnce(routeResult);

      const res = await putRoute({
        headers: { 'x-api-key': 'k' },
        body: JSON.stringify(validBody),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.path).toBe('/v1/data');
      expect(body.priceWei).toBe('1000000');
    });

    it('passes accountId and parsed input to service', async () => {
      mockAuthenticate.mockResolvedValueOnce({ accountId: VALID_UUID, plan: 'free' });
      mockUpsertRoute.mockResolvedValueOnce(routeResult);

      await putRoute({ headers: { 'x-api-key': 'k' }, body: JSON.stringify(validBody) });
      expect(mockUpsertRoute).toHaveBeenCalledWith(
        VALID_UUID,
        expect.objectContaining({ path: '/v1/data', priceWei: '1000000' }),
      );
    });

    it('throws ValidationError for missing path', async () => {
      mockAuthenticate.mockResolvedValueOnce({ accountId: VALID_UUID, plan: 'free' });
      await expect(
        putRoute({ headers: { 'x-api-key': 'k' }, body: JSON.stringify({ priceWei: '100' }) }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for path not starting with /', async () => {
      mockAuthenticate.mockResolvedValueOnce({ accountId: VALID_UUID, plan: 'free' });
      await expect(
        putRoute({
          headers: { 'x-api-key': 'k' },
          body: JSON.stringify({ path: 'no-slash', priceWei: '100' }),
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for non-numeric priceWei', async () => {
      mockAuthenticate.mockResolvedValueOnce({ accountId: VALID_UUID, plan: 'free' });
      await expect(
        putRoute({
          headers: { 'x-api-key': 'k' },
          body: JSON.stringify({ path: '/v1/x', priceWei: 'abc' }),
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws UnauthorizedError when auth fails', async () => {
      mockAuthenticate.mockRejectedValueOnce(new UnauthorizedError('missing api key'));
      await expect(putRoute({ headers: {}, body: JSON.stringify(validBody) })).rejects.toThrow(
        'missing api key',
      );
    });

    it('handles null body', async () => {
      mockAuthenticate.mockResolvedValueOnce({ accountId: VALID_UUID, plan: 'free' });
      await expect(putRoute({ headers: { 'x-api-key': 'k' }, body: null })).rejects.toThrow(
        ValidationError,
      );
    });

    it('accepts optional fraudRules', async () => {
      mockAuthenticate.mockResolvedValueOnce({ accountId: VALID_UUID, plan: 'free' });
      const bodyWithFraud = {
        ...validBody,
        fraudRules: { maxAmountWei: '5000000', velocityPerMinute: 10 },
      };
      mockUpsertRoute.mockResolvedValueOnce({
        ...routeResult,
        fraudRules: bodyWithFraud.fraudRules,
      });

      const res = await putRoute({
        headers: { 'x-api-key': 'k' },
        body: JSON.stringify(bodyWithFraud),
      });
      expect(res.statusCode).toBe(200);
      expect(mockUpsertRoute).toHaveBeenCalledWith(
        VALID_UUID,
        expect.objectContaining({ fraudRules: { maxAmountWei: '5000000', velocityPerMinute: 10 } }),
      );
    });

    it('defaults asset to USDC when omitted', async () => {
      mockAuthenticate.mockResolvedValueOnce({ accountId: VALID_UUID, plan: 'free' });
      mockUpsertRoute.mockResolvedValueOnce(routeResult);

      await putRoute({
        headers: { 'x-api-key': 'k' },
        body: JSON.stringify({ path: '/v1/x', priceWei: '100' }),
      });
      expect(mockUpsertRoute).toHaveBeenCalledWith(
        VALID_UUID,
        expect.objectContaining({ asset: 'USDC' }),
      );
    });

    it('emits route.created metric on success', async () => {
      mockAuthenticate.mockResolvedValueOnce({ accountId: VALID_UUID, plan: 'free' });
      mockUpsertRoute.mockResolvedValueOnce(routeResult);

      await putRoute({ headers: { 'x-api-key': 'k' }, body: JSON.stringify(validBody) });
      expect(mockRouteCreated).toHaveBeenCalledWith({ accountId: VALID_UUID, path: '/v1/data' });
    });

    it('handles null headers gracefully', async () => {
      mockAuthenticate.mockResolvedValueOnce({ accountId: VALID_UUID, plan: 'free' });
      mockUpsertRoute.mockResolvedValueOnce(routeResult);

      const res = await putRoute({ headers: null, body: JSON.stringify(validBody) });
      expect(res.statusCode).toBe(200);
      expect(mockAuthenticate).toHaveBeenCalledWith({});
    });

    it('propagates service errors from upsertRoute', async () => {
      mockAuthenticate.mockResolvedValueOnce({ accountId: VALID_UUID, plan: 'free' });
      mockUpsertRoute.mockRejectedValueOnce(new Error('ddb write failed'));
      await expect(
        putRoute({ headers: { 'x-api-key': 'k' }, body: JSON.stringify(validBody) }),
      ).rejects.toThrow('ddb write failed');
    });

    it('throws SyntaxError for malformed JSON body', async () => {
      mockAuthenticate.mockResolvedValueOnce({ accountId: VALID_UUID, plan: 'free' });
      await expect(putRoute({ headers: { 'x-api-key': 'k' }, body: 'not-json' })).rejects.toThrow();
    });
  });

  describe('deleteRoute', () => {
    it('returns 200 with ok:true on success', async () => {
      mockAuthenticate.mockResolvedValueOnce({ accountId: VALID_UUID, plan: 'free' });
      mockRemoveRoute.mockResolvedValueOnce(undefined);

      const res = await deleteRoute({
        headers: { 'x-api-key': 'k' },
        body: JSON.stringify({ path: '/v1/data' }),
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ ok: true });
    });

    it('passes accountId and path to service', async () => {
      mockAuthenticate.mockResolvedValueOnce({ accountId: VALID_UUID, plan: 'free' });
      mockRemoveRoute.mockResolvedValueOnce(undefined);

      await deleteRoute({
        headers: { 'x-api-key': 'k' },
        body: JSON.stringify({ path: '/v1/data' }),
      });
      expect(mockRemoveRoute).toHaveBeenCalledWith(VALID_UUID, '/v1/data');
    });

    it('throws ValidationError for missing path', async () => {
      mockAuthenticate.mockResolvedValueOnce({ accountId: VALID_UUID, plan: 'free' });
      await expect(deleteRoute({ headers: { 'x-api-key': 'k' }, body: '{}' })).rejects.toThrow(
        ValidationError,
      );
    });

    it('throws ValidationError for invalid path', async () => {
      mockAuthenticate.mockResolvedValueOnce({ accountId: VALID_UUID, plan: 'free' });
      await expect(
        deleteRoute({ headers: { 'x-api-key': 'k' }, body: JSON.stringify({ path: 'no-slash' }) }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws UnauthorizedError when auth fails', async () => {
      mockAuthenticate.mockRejectedValueOnce(new UnauthorizedError('invalid api key'));
      await expect(
        deleteRoute({ headers: {}, body: JSON.stringify({ path: '/v1/x' }) }),
      ).rejects.toThrow('invalid api key');
    });

    it('propagates NotFoundError from service', async () => {
      mockAuthenticate.mockResolvedValueOnce({ accountId: VALID_UUID, plan: 'free' });
      const { NotFoundError } = await import('../../src/lib/errors.js');
      mockRemoveRoute.mockRejectedValueOnce(new NotFoundError('Route'));
      await expect(
        deleteRoute({ headers: { 'x-api-key': 'k' }, body: JSON.stringify({ path: '/v1/x' }) }),
      ).rejects.toThrow('Route');
    });

    it('emits route.deleted metric on success', async () => {
      mockAuthenticate.mockResolvedValueOnce({ accountId: VALID_UUID, plan: 'free' });
      mockRemoveRoute.mockResolvedValueOnce(undefined);

      await deleteRoute({
        headers: { 'x-api-key': 'k' },
        body: JSON.stringify({ path: '/v1/old' }),
      });
      expect(mockRouteDeleted).toHaveBeenCalledWith({ accountId: VALID_UUID, path: '/v1/old' });
    });

    it('handles null headers gracefully', async () => {
      mockAuthenticate.mockResolvedValueOnce({ accountId: VALID_UUID, plan: 'free' });
      mockRemoveRoute.mockResolvedValueOnce(undefined);

      const res = await deleteRoute({ headers: null, body: JSON.stringify({ path: '/v1/x' }) });
      expect(res.statusCode).toBe(200);
      expect(mockAuthenticate).toHaveBeenCalledWith({});
    });

    it('handles null body by defaulting to empty object', async () => {
      mockAuthenticate.mockResolvedValueOnce({ accountId: VALID_UUID, plan: 'free' });
      await expect(deleteRoute({ headers: { 'x-api-key': 'k' }, body: null })).rejects.toThrow(
        ValidationError,
      );
    });

    it('propagates generic service errors from removeRoute', async () => {
      mockAuthenticate.mockResolvedValueOnce({ accountId: VALID_UUID, plan: 'free' });
      mockRemoveRoute.mockRejectedValueOnce(new Error('ddb timeout'));
      await expect(
        deleteRoute({ headers: { 'x-api-key': 'k' }, body: JSON.stringify({ path: '/v1/x' }) }),
      ).rejects.toThrow('ddb timeout');
    });
  });

  describe('getRoutes', () => {
    it('returns 200 with routes array', async () => {
      const routes = [
        {
          tenantId: VALID_UUID,
          path: '/v1/a',
          priceWei: '100',
          asset: 'USDC',
          createdAt: '2026-04-06T00:00:00.000Z',
          updatedAt: '2026-04-06T00:00:00.000Z',
        },
      ];
      mockAuthenticate.mockResolvedValueOnce({ accountId: VALID_UUID, plan: 'free' });
      mockListRoutes.mockResolvedValueOnce(routes);

      const res = await getRoutes({ headers: { 'x-api-key': 'k' } });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.routes).toHaveLength(1);
      expect(body.routes[0].path).toBe('/v1/a');
    });

    it('returns empty array when tenant has no routes', async () => {
      mockAuthenticate.mockResolvedValueOnce({ accountId: VALID_UUID, plan: 'free' });
      mockListRoutes.mockResolvedValueOnce([]);

      const res = await getRoutes({ headers: { 'x-api-key': 'k' } });
      expect(JSON.parse(res.body).routes).toEqual([]);
    });

    it('throws UnauthorizedError when auth fails', async () => {
      mockAuthenticate.mockRejectedValueOnce(new UnauthorizedError('missing api key'));
      await expect(getRoutes({ headers: {} })).rejects.toThrow('missing api key');
    });

    it('passes accountId to listRoutes', async () => {
      mockAuthenticate.mockResolvedValueOnce({ accountId: VALID_UUID, plan: 'starter' });
      mockListRoutes.mockResolvedValueOnce([]);

      await getRoutes({ headers: { 'x-api-key': 'k' } });
      expect(mockListRoutes).toHaveBeenCalledWith(VALID_UUID);
    });

    it('handles null headers gracefully', async () => {
      mockAuthenticate.mockResolvedValueOnce({ accountId: VALID_UUID, plan: 'free' });
      mockListRoutes.mockResolvedValueOnce([]);

      const res = await getRoutes({ headers: null });
      expect(res.statusCode).toBe(200);
      expect(mockAuthenticate).toHaveBeenCalledWith({});
    });

    it('propagates service errors from listRoutes', async () => {
      mockAuthenticate.mockResolvedValueOnce({ accountId: VALID_UUID, plan: 'free' });
      mockListRoutes.mockRejectedValueOnce(new Error('scan failed'));
      await expect(getRoutes({ headers: { 'x-api-key': 'k' } })).rejects.toThrow('scan failed');
    });
  });
});

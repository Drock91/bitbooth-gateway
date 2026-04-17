import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockVerifyApiKey = vi.fn();
const mockCreateSessionCookie = vi.fn();
const mockValidateSession = vi.fn();
const mockClearCookie = vi.fn();

const mockGetRecentPayments = vi.fn();
const mockListRoutes = vi.fn();
const mockRotateKey = vi.fn();
const mockGetByAccountId = vi.fn();
const mockListByAccount = vi.fn();
const mockGetBucket = vi.fn();

vi.mock('../../src/services/portal.service.js', () => ({
  portalService: {
    verifyApiKey: (...args) => mockVerifyApiKey(...args),
    createSessionCookie: (...args) => mockCreateSessionCookie(...args),
    validateSession: (...args) => mockValidateSession(...args),
    clearCookie: (...args) => mockClearCookie(...args),
    COOKIE_NAME: 'x402_session',
    SESSION_TTL_MS: 900000,
  },
}));
vi.mock('../../src/services/dashboard.service.js', () => ({
  dashboardService: {
    getRecentPayments: (...args) => mockGetRecentPayments(...args),
    listRoutes: (...args) => mockListRoutes(...args),
    rotateKey: (...args) => mockRotateKey(...args),
  },
}));
vi.mock('../../src/repositories/tenants.repo.js', () => ({
  tenantsRepo: {
    getByAccountId: (...args) => mockGetByAccountId(...args),
  },
}));
vi.mock('../../src/repositories/usage.repo.js', () => ({
  usageRepo: {
    listByAccount: (...args) => mockListByAccount(...args),
  },
}));
vi.mock('../../src/repositories/rate-limit.repo.js', () => ({
  rateLimitRepo: {
    getBucket: (...args) => mockGetBucket(...args),
  },
}));
vi.mock('../../src/lib/config.js', () => ({
  getConfig: () => ({
    awsRegion: 'us-east-1',
    secretArns: { adminApiKeyHash: 'arn:aws:secretsmanager:us-east-1:123:secret:admin' },
  }),
}));

import {
  getPortal,
  postLogin,
  getLogout,
  getPortalDashboard,
  getPortalIntegrate,
  postPortalRotateKey,
} from '../../src/controllers/portal.controller.js';
import { UnauthorizedError } from '../../src/lib/errors.js';

describe('portal.controller', () => {
  beforeEach(() => {
    mockVerifyApiKey.mockReset();
    mockCreateSessionCookie.mockReset();
    mockValidateSession.mockReset();
    mockClearCookie.mockReset();
    mockGetRecentPayments.mockReset();
    mockListRoutes.mockReset();
    mockRotateKey.mockReset();
    mockGetByAccountId.mockReset();
    mockListByAccount.mockReset();
    mockGetBucket.mockReset();
  });

  describe('getPortal', () => {
    it('returns 200 with HTML login page', async () => {
      const res = await getPortal();
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(res.body).toContain('Sign in');
      expect(res.body).toContain('<form');
      expect(res.body).toContain('/portal/login');
    });

    it('includes CSP header', async () => {
      const res = await getPortal();
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    });

    it('sets no-store cache control', async () => {
      const res = await getPortal();
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('includes email and apiKey input fields', async () => {
      const res = await getPortal();
      expect(res.body).toContain('type="email"');
      expect(res.body).toContain('type="password"');
      expect(res.body).toContain('name="email"');
      expect(res.body).toContain('name="apiKey"');
    });

    it('links to dashboard signup', async () => {
      const res = await getPortal();
      expect(res.body).toContain('/dashboard');
    });

    it('uses theme CSS', async () => {
      const res = await getPortal();
      expect(res.body).toContain('--accent');
      expect(res.body).toContain('--bg');
    });
  });

  describe('postLogin', () => {
    const TENANT = { accountId: 'acc-1', plan: 'starter' };
    const COOKIE = {
      name: 'x402_session',
      value: 'encoded.sig',
      options: 'x402_session=encoded.sig; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900',
    };

    it('redirects to /portal/dashboard on valid login', async () => {
      mockVerifyApiKey.mockResolvedValueOnce(TENANT);
      mockCreateSessionCookie.mockResolvedValueOnce(COOKIE);

      const event = { body: 'email=user%40example.com&apiKey=x402_abc123' };
      const res = await postLogin(event);

      expect(res.statusCode).toBe(303);
      expect(res.headers.location).toBe('/portal/dashboard');
      expect(res.headers['set-cookie']).toBe(COOKIE.options);
    });

    it('calls verifyApiKey with the raw API key', async () => {
      mockVerifyApiKey.mockResolvedValueOnce(TENANT);
      mockCreateSessionCookie.mockResolvedValueOnce(COOKIE);

      const event = { body: 'email=a%40b.com&apiKey=x402_secret' };
      await postLogin(event);

      expect(mockVerifyApiKey).toHaveBeenCalledWith('x402_secret');
    });

    it('creates session cookie with accountId and plan', async () => {
      mockVerifyApiKey.mockResolvedValueOnce(TENANT);
      mockCreateSessionCookie.mockResolvedValueOnce(COOKIE);

      const event = { body: 'email=a%40b.com&apiKey=x402_abc' };
      await postLogin(event);

      expect(mockCreateSessionCookie).toHaveBeenCalledWith('acc-1', 'starter');
    });

    it('throws ValidationError for missing email', async () => {
      const event = { body: 'apiKey=x402_abc' };
      await expect(postLogin(event)).rejects.toThrow();
    });

    it('throws ValidationError for invalid email', async () => {
      const event = { body: 'email=notanemail&apiKey=x402_abc' };
      await expect(postLogin(event)).rejects.toThrow();
    });

    it('throws ValidationError for missing apiKey', async () => {
      const event = { body: 'email=a%40b.com' };
      await expect(postLogin(event)).rejects.toThrow();
    });

    it('propagates UnauthorizedError from verifyApiKey', async () => {
      mockVerifyApiKey.mockRejectedValueOnce(new UnauthorizedError('Invalid API key'));
      const event = { body: 'email=a%40b.com&apiKey=x402_bad' };
      await expect(postLogin(event)).rejects.toThrow('Invalid API key');
    });

    it('handles null event.body', async () => {
      const event = { body: null };
      await expect(postLogin(event)).rejects.toThrow();
    });

    it('handles undefined event.body', async () => {
      const event = {};
      await expect(postLogin(event)).rejects.toThrow();
    });

    it('sets no-store cache control', async () => {
      mockVerifyApiKey.mockResolvedValueOnce(TENANT);
      mockCreateSessionCookie.mockResolvedValueOnce(COOKIE);

      const event = { body: 'email=a%40b.com&apiKey=x402_abc' };
      const res = await postLogin(event);
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });

  describe('getLogout', () => {
    it('redirects to /portal', async () => {
      mockClearCookie.mockReturnValueOnce(
        'x402_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0',
      );
      const res = await getLogout();
      expect(res.statusCode).toBe(303);
      expect(res.headers.location).toBe('/portal');
    });

    it('sets clear cookie header', async () => {
      mockClearCookie.mockReturnValueOnce(
        'x402_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0',
      );
      const res = await getLogout();
      expect(res.headers['set-cookie']).toContain('Max-Age=0');
    });

    it('sets no-store cache control', async () => {
      mockClearCookie.mockReturnValueOnce('x402_session=; Max-Age=0');
      const res = await getLogout();
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });

  describe('getPortalDashboard', () => {
    const SESSION = { accountId: 'acc-1', plan: 'starter' };
    const TENANT = { accountId: 'acc-1', plan: 'starter', createdAt: '2026-01-01T00:00:00Z' };
    const PAYMENTS = [{ idempotencyKey: 'n-1', amountWei: '100', status: 'confirmed' }];
    const ROUTES = [{ path: '/api/data', priceWei: '50', asset: 'USDC' }];
    const USAGE = [{ yearMonth: '2026-04', callCount: 10 }];
    const BUCKET = { accountId: 'acc-1', tokens: 90, capacity: 100, refillRate: 1 };

    function setupMocks() {
      mockValidateSession.mockResolvedValue(SESSION);
      mockGetByAccountId.mockResolvedValue(TENANT);
      mockGetRecentPayments.mockResolvedValue(PAYMENTS);
      mockListRoutes.mockResolvedValue(ROUTES);
      mockListByAccount.mockResolvedValue(USAGE);
      mockGetBucket.mockResolvedValue(BUCKET);
    }

    it('returns 200 with HTML', async () => {
      setupMocks();
      const res = await getPortalDashboard({ headers: { cookie: 'x402_session=tok.sig' } });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    });

    it('validates session from cookie header', async () => {
      setupMocks();
      await getPortalDashboard({ headers: { cookie: 'x402_session=tok.sig' } });
      expect(mockValidateSession).toHaveBeenCalledWith('x402_session=tok.sig');
    });

    it('validates session from Cookie header (capitalized)', async () => {
      setupMocks();
      await getPortalDashboard({ headers: { Cookie: 'x402_session=tok.sig' } });
      expect(mockValidateSession).toHaveBeenCalledWith('x402_session=tok.sig');
    });

    it('fetches tenant, payments, routes, usage, and rate limit', async () => {
      setupMocks();
      await getPortalDashboard({ headers: { cookie: 'x402_session=tok.sig' } });
      expect(mockGetByAccountId).toHaveBeenCalledWith('acc-1');
      expect(mockGetRecentPayments).toHaveBeenCalledWith('acc-1', 20);
      expect(mockListRoutes).toHaveBeenCalledWith('acc-1');
      expect(mockListByAccount).toHaveBeenCalledWith('acc-1', 6);
      expect(mockGetBucket).toHaveBeenCalledWith('acc-1');
    });

    it('renders plan, usage, and rate limit data in HTML', async () => {
      setupMocks();
      const res = await getPortalDashboard({ headers: { cookie: 'x402_session=tok.sig' } });
      expect(res.body).toContain('starter');
      expect(res.body).toContain('/api/data');
      expect(res.body).toContain('n-1');
    });

    it('includes CSP header', async () => {
      setupMocks();
      const res = await getPortalDashboard({ headers: { cookie: 'x402_session=tok.sig' } });
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    });

    it('sets no-store cache control', async () => {
      setupMocks();
      const res = await getPortalDashboard({ headers: { cookie: 'x402_session=tok.sig' } });
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('throws UnauthorizedError when no cookie', async () => {
      mockValidateSession.mockRejectedValue(new UnauthorizedError('No session'));
      await expect(getPortalDashboard({ headers: {} })).rejects.toThrow('No session');
    });

    it('throws UnauthorizedError for expired session', async () => {
      mockValidateSession.mockRejectedValue(new UnauthorizedError('Session expired'));
      await expect(
        getPortalDashboard({ headers: { cookie: 'x402_session=old.sig' } }),
      ).rejects.toThrow('Session expired');
    });

    it('handles null headers', async () => {
      mockValidateSession.mockRejectedValue(new UnauthorizedError('No session'));
      await expect(getPortalDashboard({ headers: null })).rejects.toThrow();
    });

    it('handles null rate limit bucket', async () => {
      setupMocks();
      mockGetBucket.mockResolvedValue(null);
      const res = await getPortalDashboard({ headers: { cookie: 'x402_session=tok.sig' } });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('\u2014');
    });

    it('includes sign-out link', async () => {
      setupMocks();
      const res = await getPortalDashboard({ headers: { cookie: 'x402_session=tok.sig' } });
      expect(res.body).toContain('/portal/logout');
    });

    it('includes rotate key button', async () => {
      setupMocks();
      const res = await getPortalDashboard({ headers: { cookie: 'x402_session=tok.sig' } });
      expect(res.body).toContain('Rotate');
      expect(res.body).toContain('/portal/rotate-key');
    });
  });

  describe('getPortalIntegrate', () => {
    const SESSION = { accountId: 'acc-1', plan: 'growth' };

    it('returns 200 with HTML', async () => {
      mockValidateSession.mockResolvedValue(SESSION);
      const res = await getPortalIntegrate({ headers: { cookie: 'x402_session=tok.sig' } });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    });

    it('validates session from cookie header', async () => {
      mockValidateSession.mockResolvedValue(SESSION);
      await getPortalIntegrate({ headers: { cookie: 'x402_session=tok.sig' } });
      expect(mockValidateSession).toHaveBeenCalledWith('x402_session=tok.sig');
    });

    it('reads Cookie header (capitalized)', async () => {
      mockValidateSession.mockResolvedValue(SESSION);
      await getPortalIntegrate({ headers: { Cookie: 'x402_session=tok.sig' } });
      expect(mockValidateSession).toHaveBeenCalledWith('x402_session=tok.sig');
    });

    it('includes CSP header', async () => {
      mockValidateSession.mockResolvedValue(SESSION);
      const res = await getPortalIntegrate({ headers: { cookie: 'x402_session=tok.sig' } });
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    });

    it('sets no-store cache control', async () => {
      mockValidateSession.mockResolvedValue(SESSION);
      const res = await getPortalIntegrate({ headers: { cookie: 'x402_session=tok.sig' } });
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('includes Integration Guide title', async () => {
      mockValidateSession.mockResolvedValue(SESSION);
      const res = await getPortalIntegrate({ headers: { cookie: 'x402_session=tok.sig' } });
      expect(res.body).toContain('Integration Guide');
    });

    it('renders account ID', async () => {
      mockValidateSession.mockResolvedValue(SESSION);
      const res = await getPortalIntegrate({ headers: { cookie: 'x402_session=tok.sig' } });
      expect(res.body).toContain('acc-1');
    });

    it('renders plan', async () => {
      mockValidateSession.mockResolvedValue(SESSION);
      const res = await getPortalIntegrate({ headers: { cookie: 'x402_session=tok.sig' } });
      expect(res.body).toContain('growth');
    });

    it('includes curl code sample', async () => {
      mockValidateSession.mockResolvedValue(SESSION);
      const res = await getPortalIntegrate({ headers: { cookie: 'x402_session=tok.sig' } });
      expect(res.body).toContain('curl');
      expect(res.body).toContain('X-PAYMENT');
    });

    it('includes JavaScript code sample', async () => {
      mockValidateSession.mockResolvedValue(SESSION);
      const res = await getPortalIntegrate({ headers: { cookie: 'x402_session=tok.sig' } });
      expect(res.body).toContain('ethers');
      expect(res.body).toContain('JsonRpcProvider');
    });

    it('includes Python code sample', async () => {
      mockValidateSession.mockResolvedValue(SESSION);
      const res = await getPortalIntegrate({ headers: { cookie: 'x402_session=tok.sig' } });
      expect(res.body).toContain('web3');
      expect(res.body).toContain('requests');
    });

    it('includes three tabs', async () => {
      mockValidateSession.mockResolvedValue(SESSION);
      const res = await getPortalIntegrate({ headers: { cookie: 'x402_session=tok.sig' } });
      expect(res.body).toContain('data-tab="curl"');
      expect(res.body).toContain('data-tab="javascript"');
      expect(res.body).toContain('data-tab="python"');
    });

    it('links to dashboard and docs', async () => {
      mockValidateSession.mockResolvedValue(SESSION);
      const res = await getPortalIntegrate({ headers: { cookie: 'x402_session=tok.sig' } });
      expect(res.body).toContain('/portal/dashboard');
      expect(res.body).toContain('/docs');
    });

    it('links to sign out', async () => {
      mockValidateSession.mockResolvedValue(SESSION);
      const res = await getPortalIntegrate({ headers: { cookie: 'x402_session=tok.sig' } });
      expect(res.body).toContain('/portal/logout');
    });

    it('throws UnauthorizedError when no cookie', async () => {
      mockValidateSession.mockRejectedValue(new UnauthorizedError('No session'));
      await expect(getPortalIntegrate({ headers: {} })).rejects.toThrow('No session');
    });

    it('throws UnauthorizedError for expired session', async () => {
      mockValidateSession.mockRejectedValue(new UnauthorizedError('Session expired'));
      await expect(
        getPortalIntegrate({ headers: { cookie: 'x402_session=old.sig' } }),
      ).rejects.toThrow('Session expired');
    });

    it('handles null headers', async () => {
      mockValidateSession.mockRejectedValue(new UnauthorizedError('No session'));
      await expect(getPortalIntegrate({ headers: null })).rejects.toThrow();
    });
  });

  describe('postPortalRotateKey', () => {
    const SESSION = { accountId: 'acc-1', plan: 'starter' };

    it('returns 200 with new API key', async () => {
      mockValidateSession.mockResolvedValue(SESSION);
      mockRotateKey.mockResolvedValue({ accountId: 'acc-1', apiKey: 'x402_newkey' });

      const res = await postPortalRotateKey({ headers: { cookie: 'x402_session=tok.sig' } });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.apiKey).toBe('x402_newkey');
      expect(body.accountId).toBe('acc-1');
    });

    it('validates session cookie', async () => {
      mockValidateSession.mockResolvedValue(SESSION);
      mockRotateKey.mockResolvedValue({ accountId: 'acc-1', apiKey: 'x402_k' });

      await postPortalRotateKey({ headers: { cookie: 'x402_session=tok.sig' } });
      expect(mockValidateSession).toHaveBeenCalledWith('x402_session=tok.sig');
    });

    it('calls rotateKey with session accountId', async () => {
      mockValidateSession.mockResolvedValue(SESSION);
      mockRotateKey.mockResolvedValue({ accountId: 'acc-1', apiKey: 'x402_k' });

      await postPortalRotateKey({ headers: { cookie: 'x402_session=tok.sig' } });
      expect(mockRotateKey).toHaveBeenCalledWith('acc-1');
    });

    it('returns JSON content type', async () => {
      mockValidateSession.mockResolvedValue(SESSION);
      mockRotateKey.mockResolvedValue({ accountId: 'acc-1', apiKey: 'x402_k' });

      const res = await postPortalRotateKey({ headers: { cookie: 'x402_session=tok.sig' } });
      expect(res.headers['content-type']).toBe('application/json');
    });

    it('sets no-store cache control', async () => {
      mockValidateSession.mockResolvedValue(SESSION);
      mockRotateKey.mockResolvedValue({ accountId: 'acc-1', apiKey: 'x402_k' });

      const res = await postPortalRotateKey({ headers: { cookie: 'x402_session=tok.sig' } });
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('throws UnauthorizedError when no session', async () => {
      mockValidateSession.mockRejectedValue(new UnauthorizedError('No session'));
      await expect(postPortalRotateKey({ headers: {} })).rejects.toThrow('No session');
    });

    it('includes rotation message in response', async () => {
      mockValidateSession.mockResolvedValue(SESSION);
      mockRotateKey.mockResolvedValue({ accountId: 'acc-1', apiKey: 'x402_k' });

      const res = await postPortalRotateKey({ headers: { cookie: 'x402_session=tok.sig' } });
      const body = JSON.parse(res.body);
      expect(body.message).toContain('rotated');
    });

    it('reads Cookie header (capitalized)', async () => {
      mockValidateSession.mockResolvedValue(SESSION);
      mockRotateKey.mockResolvedValue({ accountId: 'acc-1', apiKey: 'x402_k' });

      await postPortalRotateKey({ headers: { Cookie: 'x402_session=tok.sig' } });
      expect(mockValidateSession).toHaveBeenCalledWith('x402_session=tok.sig');
    });
  });
});

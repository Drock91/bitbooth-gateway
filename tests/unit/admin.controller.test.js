import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockListTenantsSvc = vi.hoisted(() => vi.fn());
const mockValidateSession = vi.hoisted(() => vi.fn());
const mockVerifyAdminKey = vi.hoisted(() => vi.fn());
const mockCreateSessionCookie = vi.hoisted(() => vi.fn());
const mockClearCookie = vi.hoisted(() => vi.fn());
const mockAuditLog = vi.hoisted(() => vi.fn());
const mockGetRevenueStats = vi.hoisted(() => vi.fn());
const mockEnforceAdminRateLimit = vi.hoisted(() => vi.fn());
const mockExtractClientIp = vi.hoisted(() => vi.fn());
const mockGetDashboard = vi.hoisted(() => vi.fn());

vi.mock('../../src/services/admin.service.js', () => ({
  adminService: {
    listTenants: mockListTenantsSvc,
    validateSession: mockValidateSession,
    verifyAdminKey: mockVerifyAdminKey,
    createSessionCookie: mockCreateSessionCookie,
    clearCookie: mockClearCookie,
    auditLog: mockAuditLog,
    getRevenueStats: mockGetRevenueStats,
    COOKIE_NAME: 'x402_admin_session',
    SESSION_TTL_MS: 900000,
  },
}));
vi.mock('../../src/services/metrics.service.js', () => ({
  metricsService: { getDashboard: mockGetDashboard },
}));
vi.mock('../../src/middleware/error.middleware.js', () => ({
  jsonResponse: (status, body) => ({
    statusCode: status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }),
}));
vi.mock('../../src/middleware/rate-limit.middleware.js', () => ({
  enforceAdminRateLimit: mockEnforceAdminRateLimit,
  extractClientIp: mockExtractClientIp,
  rateLimitHeaders: (info) => ({
    'ratelimit-limit': String(info.limit),
    'ratelimit-remaining': String(info.remaining),
    'ratelimit-reset': String(info.reset),
  }),
}));
vi.mock('../../src/lib/config.js', () => ({
  getConfig: () => ({
    awsRegion: 'us-east-1',
    secretArns: { adminApiKeyHash: 'arn:aws:secretsmanager:us-east-1:123:secret:admin' },
  }),
}));

const mockUpdateStatus = vi.hoisted(() => vi.fn());
vi.mock('../../src/repositories/tenants.repo.js', () => ({
  tenantsRepo: { updateStatus: mockUpdateStatus },
}));

import {
  getAdmin,
  postAdminLogin,
  getAdminLogout,
} from '../../src/controllers/admin.login.controller.js';
import {
  listTenants,
  listTenantsUI,
  suspendTenant,
  reactivateTenant,
} from '../../src/controllers/admin.tenants.controller.js';
import { getAdminMetricsUI } from '../../src/controllers/admin.metrics.controller.js';
import { UnauthorizedError, TooManyRequestsError } from '../../src/lib/errors.js';

const SESSION = {
  role: 'admin',
  refreshCookie:
    'x402_admin_session=refreshed.sig; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900',
};
const COOKIE = {
  name: 'x402_admin_session',
  value: 'encoded.sig',
  options: 'x402_admin_session=encoded.sig; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900',
};

function makeEvent(overrides = {}) {
  return {
    headers: { cookie: 'x402_admin_session=tok.sig', ...overrides.headers },
    queryStringParameters: overrides.query ?? null,
    body: overrides.body ?? null,
    requestContext: { identity: { sourceIp: '10.0.0.1' } },
  };
}

describe('admin.controller', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockValidateSession.mockResolvedValue(SESSION);
    mockListTenantsSvc.mockResolvedValue({ tenants: [], nextCursor: null });
    mockExtractClientIp.mockReturnValue('10.0.0.1');
    mockEnforceAdminRateLimit.mockResolvedValue({ limit: 30, remaining: 29, reset: 120 });
    mockVerifyAdminKey.mockResolvedValue(undefined);
    mockCreateSessionCookie.mockResolvedValue(COOKIE);
    mockClearCookie.mockReturnValue(
      'x402_admin_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0',
    );
    mockAuditLog.mockResolvedValue(undefined);
    mockGetRevenueStats.mockResolvedValue({ mrr: 0, payingCount: 0 });
    mockGetDashboard.mockResolvedValue({
      mrr: 148,
      payingCount: 2,
      total402s: 42,
      totalUsdc: 21.5,
      fetchesTotal: 7,
      fetchRevenueUsdc: 0.035,
      fraudCounts: { h24: 3, h7d: 10, h30d: 25 },
      topTenants: [{ accountId: 'acc-1', paymentCount: 15, totalUsdcMicro: 5000000 }],
    });
  });

  describe('getAdmin', () => {
    it('returns 200 with HTML login page', async () => {
      const res = await getAdmin();
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(res.body).toContain('Admin');
      expect(res.body).toContain('<form');
      expect(res.body).toContain('/admin/login');
    });

    it('includes CSP header', async () => {
      const res = await getAdmin();
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    });

    it('sets no-store cache control', async () => {
      const res = await getAdmin();
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('includes password input field', async () => {
      const res = await getAdmin();
      expect(res.body).toContain('type="password"');
      expect(res.body).toContain('name="password"');
    });

    it('uses theme CSS', async () => {
      const res = await getAdmin();
      expect(res.body).toContain('--accent');
      expect(res.body).toContain('--bg');
    });

    it('includes x-content-type-options header', async () => {
      const res = await getAdmin();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  describe('postAdminLogin', () => {
    it('redirects to /admin/tenants/ui on valid login', async () => {
      const event = makeEvent({ body: 'password=admin-secret-key' });
      const res = await postAdminLogin(event);
      expect(res.statusCode).toBe(303);
      expect(res.headers.location).toBe('/admin/tenants/ui');
      expect(res.headers['set-cookie']).toBe(COOKIE.options);
    });

    it('calls verifyAdminKey with the password', async () => {
      const event = makeEvent({ body: 'password=my-admin-key' });
      await postAdminLogin(event);
      expect(mockVerifyAdminKey).toHaveBeenCalledWith('my-admin-key');
    });

    it('creates session cookie on valid auth', async () => {
      const event = makeEvent({ body: 'password=admin-key' });
      await postAdminLogin(event);
      expect(mockCreateSessionCookie).toHaveBeenCalled();
    });

    it('audit logs the login action', async () => {
      const event = makeEvent({ body: 'password=admin-key' });
      await postAdminLogin(event);
      expect(mockAuditLog).toHaveBeenCalledWith('login', { ip: '10.0.0.1' });
    });

    it('throws ValidationError for missing password', async () => {
      const event = makeEvent({ body: '' });
      await expect(postAdminLogin(event)).rejects.toThrow();
    });

    it('propagates UnauthorizedError from verifyAdminKey', async () => {
      mockVerifyAdminKey.mockRejectedValueOnce(new UnauthorizedError('Invalid admin credentials'));
      const event = makeEvent({ body: 'password=bad-key' });
      await expect(postAdminLogin(event)).rejects.toThrow('Invalid admin credentials');
    });

    it('handles null event.body', async () => {
      const event = makeEvent({ body: null });
      await expect(postAdminLogin(event)).rejects.toThrow();
    });

    it('enforces rate limit before auth', async () => {
      const order = [];
      mockEnforceAdminRateLimit.mockImplementation(async () => {
        order.push('rateLimit');
        return { limit: 30, remaining: 29, reset: 120 };
      });
      mockVerifyAdminKey.mockImplementation(async () => {
        order.push('auth');
      });

      const event = makeEvent({ body: 'password=admin-key' });
      await postAdminLogin(event);
      expect(order).toEqual(['rateLimit', 'auth']);
    });

    it('rejects with 429 when rate limit exceeded', async () => {
      mockEnforceAdminRateLimit.mockRejectedValue(new TooManyRequestsError(120, 30));
      const event = makeEvent({ body: 'password=admin-key' });
      await expect(postAdminLogin(event)).rejects.toThrow(TooManyRequestsError);
      expect(mockVerifyAdminKey).not.toHaveBeenCalled();
    });

    it('sets no-store cache control', async () => {
      const event = makeEvent({ body: 'password=admin-key' });
      const res = await postAdminLogin(event);
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });

  describe('getAdminLogout', () => {
    it('redirects to /admin', async () => {
      const event = makeEvent();
      const res = await getAdminLogout(event);
      expect(res.statusCode).toBe(303);
      expect(res.headers.location).toBe('/admin');
    });

    it('sets clear cookie header', async () => {
      const event = makeEvent();
      const res = await getAdminLogout(event);
      expect(res.headers['set-cookie']).toContain('Max-Age=0');
    });

    it('audit logs the logout action', async () => {
      const event = makeEvent();
      await getAdminLogout(event);
      expect(mockAuditLog).toHaveBeenCalledWith('logout', {});
    });

    it('clears cookie even when session is invalid', async () => {
      mockValidateSession.mockRejectedValue(new UnauthorizedError('Expired'));
      const event = makeEvent();
      const res = await getAdminLogout(event);
      expect(res.statusCode).toBe(303);
      expect(res.headers['set-cookie']).toContain('Max-Age=0');
    });

    it('sets no-store cache control', async () => {
      const event = makeEvent();
      const res = await getAdminLogout(event);
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('reads Cookie header (capitalized)', async () => {
      const event = { headers: { Cookie: 'x402_admin_session=tok.sig' } };
      await getAdminLogout(event);
      expect(mockValidateSession).toHaveBeenCalledWith('x402_admin_session=tok.sig');
    });

    it('handles null headers', async () => {
      mockValidateSession.mockRejectedValue(new UnauthorizedError('No session'));
      const event = { headers: null };
      const res = await getAdminLogout(event);
      expect(res.statusCode).toBe(303);
    });
  });

  describe('listTenants', () => {
    it('returns tenants list with 200', async () => {
      const tenants = [{ accountId: 'acc-1', plan: 'free' }];
      mockListTenantsSvc.mockResolvedValue({ tenants, nextCursor: 'abc' });
      const res = await listTenants(makeEvent());
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.tenants).toEqual(tenants);
      expect(body.nextCursor).toBe('abc');
    });

    it('validates session from cookie header', async () => {
      await listTenants(makeEvent());
      expect(mockValidateSession).toHaveBeenCalledWith('x402_admin_session=tok.sig');
    });

    it('validates session from Cookie header (capitalized)', async () => {
      const event = makeEvent({ headers: { Cookie: 'x402_admin_session=tok.sig' } });
      delete event.headers.cookie;
      await listTenants(event);
      expect(mockValidateSession).toHaveBeenCalledWith('x402_admin_session=tok.sig');
    });

    it('throws UnauthorizedError when no session', async () => {
      mockValidateSession.mockRejectedValue(new UnauthorizedError('No admin session'));
      const event = makeEvent({ headers: {} });
      await expect(listTenants(event)).rejects.toThrow('No admin session');
    });

    it('passes limit and cursor to service', async () => {
      await listTenants(makeEvent({ query: { limit: '10', cursor: 'xyz' } }));
      expect(mockListTenantsSvc).toHaveBeenCalledWith({
        limit: 10,
        cursor: 'xyz',
        plan: undefined,
      });
    });

    it('passes plan filter to service', async () => {
      await listTenants(makeEvent({ query: { plan: 'growth' } }));
      expect(mockListTenantsSvc).toHaveBeenCalledWith(expect.objectContaining({ plan: 'growth' }));
    });

    it('throws ValidationError for invalid limit', async () => {
      await expect(listTenants(makeEvent({ query: { limit: '0' } }))).rejects.toThrow(
        'Invalid request',
      );
    });

    it('throws ValidationError for invalid plan', async () => {
      await expect(listTenants(makeEvent({ query: { plan: 'bad' } }))).rejects.toThrow(
        'Invalid request',
      );
    });

    it('handles null queryStringParameters', async () => {
      const event = makeEvent({ query: null });
      event.queryStringParameters = null;
      const res = await listTenants(event);
      expect(res.statusCode).toBe(200);
    });

    it('audit logs the listTenants action', async () => {
      await listTenants(makeEvent({ query: { plan: 'starter' } }));
      expect(mockAuditLog).toHaveBeenCalledWith('listTenants', {
        limit: 20,
        plan: 'starter',
      });
    });

    it('includes ratelimit headers in response', async () => {
      mockEnforceAdminRateLimit.mockResolvedValue({ limit: 30, remaining: 25, reset: 120 });
      const res = await listTenants(makeEvent());
      expect(res.headers['ratelimit-limit']).toBe('30');
      expect(res.headers['ratelimit-remaining']).toBe('25');
    });

    it('sets refreshed session cookie on response', async () => {
      const res = await listTenants(makeEvent());
      expect(res.headers['set-cookie']).toBe(SESSION.refreshCookie);
    });

    it('enforces rate limit before session validation', async () => {
      const order = [];
      mockEnforceAdminRateLimit.mockImplementation(async () => {
        order.push('rateLimit');
        return { limit: 30, remaining: 29, reset: 120 };
      });
      mockValidateSession.mockImplementation(async () => {
        order.push('session');
        return SESSION;
      });

      await listTenants(makeEvent());
      expect(order).toEqual(['rateLimit', 'session']);
    });

    it('rejects with 429 when rate limit exceeded', async () => {
      mockEnforceAdminRateLimit.mockRejectedValue(new TooManyRequestsError(120, 30));
      await expect(listTenants(makeEvent())).rejects.toThrow(TooManyRequestsError);
      expect(mockValidateSession).not.toHaveBeenCalled();
    });

    it('uses default limit of 20 when not provided', async () => {
      await listTenants(makeEvent());
      expect(mockListTenantsSvc).toHaveBeenCalledWith(expect.objectContaining({ limit: 20 }));
    });

    it('handles null headers gracefully', async () => {
      mockValidateSession.mockRejectedValue(new UnauthorizedError('No admin session'));
      const event = {
        headers: null,
        queryStringParameters: null,
        requestContext: { identity: { sourceIp: '10.0.0.1' } },
      };
      await expect(listTenants(event)).rejects.toThrow();
    });
  });

  describe('listTenantsUI', () => {
    it('returns 200 with HTML table', async () => {
      mockListTenantsSvc.mockResolvedValue({ tenants: [], nextCursor: null });
      const res = await listTenantsUI(makeEvent());
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(res.body).toContain('<table>');
    });

    it('validates session before listing', async () => {
      mockListTenantsSvc.mockResolvedValue({ tenants: [], nextCursor: null });
      await listTenantsUI(makeEvent());
      expect(mockValidateSession).toHaveBeenCalledWith('x402_admin_session=tok.sig');
    });

    it('throws UnauthorizedError when no session', async () => {
      mockValidateSession.mockRejectedValue(new UnauthorizedError('No admin session'));
      await expect(listTenantsUI(makeEvent({ headers: {} }))).rejects.toThrow('No admin session');
    });

    it('renders tenant rows in the table', async () => {
      mockListTenantsSvc.mockResolvedValue({
        tenants: [
          {
            accountId: 'acc-1',
            plan: 'free',
            status: 'active',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        nextCursor: null,
      });
      const res = await listTenantsUI(makeEvent());
      expect(res.body).toContain('acc-1');
      expect(res.body).toContain('free');
    });

    it('renders suspend button for active tenants', async () => {
      mockListTenantsSvc.mockResolvedValue({
        tenants: [
          {
            accountId: 'acc-1',
            plan: 'free',
            status: 'active',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        nextCursor: null,
      });
      const res = await listTenantsUI(makeEvent());
      expect(res.body).toContain('/suspend');
      expect(res.body).toContain('Suspend');
    });

    it('renders reactivate button for suspended tenants', async () => {
      mockListTenantsSvc.mockResolvedValue({
        tenants: [
          {
            accountId: 'acc-1',
            plan: 'free',
            status: 'suspended',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        nextCursor: null,
      });
      const res = await listTenantsUI(makeEvent());
      expect(res.body).toContain('/reactivate');
      expect(res.body).toContain('Reactivate');
    });

    it('renders pagination link when nextCursor exists', async () => {
      mockListTenantsSvc.mockResolvedValue({
        tenants: [],
        nextCursor: 'abc123',
      });
      const res = await listTenantsUI(makeEvent());
      expect(res.body).toContain('cursor=abc123');
      expect(res.body).toContain('Next');
    });

    it('does not render pagination when no nextCursor', async () => {
      mockListTenantsSvc.mockResolvedValue({ tenants: [], nextCursor: null });
      const res = await listTenantsUI(makeEvent());
      expect(res.body).not.toContain('cursor=');
    });

    it('passes limit, cursor, plan from query to service', async () => {
      mockListTenantsSvc.mockResolvedValue({ tenants: [], nextCursor: null });
      await listTenantsUI(makeEvent({ query: { limit: '25', cursor: 'cur', plan: 'growth' } }));
      expect(mockListTenantsSvc).toHaveBeenCalledWith({ limit: 25, cursor: 'cur', plan: 'growth' });
    });

    it('uses default limit of 50', async () => {
      mockListTenantsSvc.mockResolvedValue({ tenants: [], nextCursor: null });
      await listTenantsUI(makeEvent());
      expect(mockListTenantsSvc).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
    });

    it('throws ValidationError for invalid limit', async () => {
      await expect(listTenantsUI(makeEvent({ query: { limit: '0' } }))).rejects.toThrow();
    });

    it('throws ValidationError for invalid plan', async () => {
      await expect(listTenantsUI(makeEvent({ query: { plan: 'invalid' } }))).rejects.toThrow();
    });

    it('audit logs the listTenantsUI action', async () => {
      mockListTenantsSvc.mockResolvedValue({ tenants: [], nextCursor: null });
      await listTenantsUI(makeEvent({ query: { plan: 'starter' } }));
      expect(mockAuditLog).toHaveBeenCalledWith('listTenantsUI', { limit: 50, plan: 'starter' });
    });

    it('includes CSP header', async () => {
      mockListTenantsSvc.mockResolvedValue({ tenants: [], nextCursor: null });
      const res = await listTenantsUI(makeEvent());
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    });

    it('sets refreshed session cookie', async () => {
      mockListTenantsSvc.mockResolvedValue({ tenants: [], nextCursor: null });
      const res = await listTenantsUI(makeEvent());
      expect(res.headers['set-cookie']).toBe(SESSION.refreshCookie);
    });

    it('does not set cookie when no refreshCookie', async () => {
      mockValidateSession.mockResolvedValue({ role: 'admin', refreshCookie: null });
      mockListTenantsSvc.mockResolvedValue({ tenants: [], nextCursor: null });
      const res = await listTenantsUI(makeEvent());
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('enforces rate limit before session validation', async () => {
      const order = [];
      mockEnforceAdminRateLimit.mockImplementation(async () => {
        order.push('rateLimit');
      });
      mockValidateSession.mockImplementation(async () => {
        order.push('session');
        return SESSION;
      });
      mockListTenantsSvc.mockResolvedValue({ tenants: [], nextCursor: null });
      await listTenantsUI(makeEvent());
      expect(order).toEqual(['rateLimit', 'session']);
    });

    it('rejects with 429 when rate limit exceeded', async () => {
      mockEnforceAdminRateLimit.mockRejectedValue(new TooManyRequestsError(120, 30));
      await expect(listTenantsUI(makeEvent())).rejects.toThrow(TooManyRequestsError);
      expect(mockValidateSession).not.toHaveBeenCalled();
    });

    it('renders "No tenants found" when list is empty', async () => {
      mockListTenantsSvc.mockResolvedValue({ tenants: [], nextCursor: null });
      const res = await listTenantsUI(makeEvent());
      expect(res.body).toContain('No tenants found');
    });

    it('renders status badge for active tenant', async () => {
      mockListTenantsSvc.mockResolvedValue({
        tenants: [
          {
            accountId: 'acc-1',
            plan: 'free',
            status: 'active',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        nextCursor: null,
      });
      const res = await listTenantsUI(makeEvent());
      expect(res.body).toContain('confirmed');
      expect(res.body).toContain('active');
    });

    it('renders status badge for suspended tenant', async () => {
      mockListTenantsSvc.mockResolvedValue({
        tenants: [
          {
            accountId: 'acc-1',
            plan: 'free',
            status: 'suspended',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        nextCursor: null,
      });
      const res = await listTenantsUI(makeEvent());
      expect(res.body).toContain('error-badge');
      expect(res.body).toContain('suspended');
    });

    it('includes plan filter dropdown with current selection', async () => {
      mockListTenantsSvc.mockResolvedValue({ tenants: [], nextCursor: null });
      const res = await listTenantsUI(makeEvent({ query: { plan: 'growth' } }));
      expect(res.body).toContain('selected');
      expect(res.body).toContain('growth');
    });

    it('preserves plan in pagination link', async () => {
      mockListTenantsSvc.mockResolvedValue({ tenants: [], nextCursor: 'next123' });
      const res = await listTenantsUI(makeEvent({ query: { plan: 'starter' } }));
      expect(res.body).toContain('plan=starter');
    });

    it('renders logout link', async () => {
      mockListTenantsSvc.mockResolvedValue({ tenants: [], nextCursor: null });
      const res = await listTenantsUI(makeEvent());
      expect(res.body).toContain('/admin/logout');
      expect(res.body).toContain('Logout');
    });

    it('escapes accountId in HTML output', async () => {
      mockListTenantsSvc.mockResolvedValue({
        tenants: [
          {
            accountId: '<script>alert(1)</script>',
            plan: 'free',
            status: 'active',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        nextCursor: null,
      });
      const res = await listTenantsUI(makeEvent());
      expect(res.body).not.toContain('<script>');
      expect(res.body).toContain('&lt;script&gt;');
    });

    it('renders tenant with null status as active', async () => {
      mockListTenantsSvc.mockResolvedValue({
        tenants: [{ accountId: 'acc-1', plan: 'free', createdAt: '2026-01-01T00:00:00.000Z' }],
        nextCursor: null,
      });
      const res = await listTenantsUI(makeEvent());
      expect(res.body).toContain('Suspend');
      expect(res.body).toContain('active');
    });

    it('handles null queryStringParameters', async () => {
      mockListTenantsSvc.mockResolvedValue({ tenants: [], nextCursor: null });
      const event = makeEvent();
      event.queryStringParameters = null;
      const res = await listTenantsUI(event);
      expect(res.statusCode).toBe(200);
    });

    it('renders MRR pill with revenue stats', async () => {
      mockListTenantsSvc.mockResolvedValue({ tenants: [], nextCursor: null });
      mockGetRevenueStats.mockResolvedValue({ mrr: 148, payingCount: 3 });
      const res = await listTenantsUI(makeEvent());
      expect(res.body).toContain('$148');
      expect(res.body).toContain('MRR');
      expect(res.body).toContain('3');
      expect(res.body).toContain('Paying Tenants');
    });

    it('renders $0 MRR when no paying tenants', async () => {
      mockListTenantsSvc.mockResolvedValue({ tenants: [], nextCursor: null });
      mockGetRevenueStats.mockResolvedValue({ mrr: 0, payingCount: 0 });
      const res = await listTenantsUI(makeEvent());
      expect(res.body).toContain('$0');
    });

    it('calls getRevenueStats in parallel with listTenants', async () => {
      mockListTenantsSvc.mockResolvedValue({ tenants: [], nextCursor: null });
      mockGetRevenueStats.mockResolvedValue({ mrr: 49, payingCount: 1 });
      await listTenantsUI(makeEvent());
      expect(mockGetRevenueStats).toHaveBeenCalledOnce();
      expect(mockListTenantsSvc).toHaveBeenCalledOnce();
    });
  });

  describe('suspendTenant', () => {
    beforeEach(() => {
      mockUpdateStatus.mockResolvedValue({
        ...{
          accountId: 'acc-1',
          plan: 'free',
          status: 'suspended',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      });
    });

    it('redirects to /admin/tenants/ui', async () => {
      const event = { ...makeEvent(), pathParameters: { id: 'acc-1' } };
      const res = await suspendTenant(event);
      expect(res.statusCode).toBe(303);
      expect(res.headers.location).toBe('/admin/tenants/ui');
    });

    it('calls updateStatus with suspended', async () => {
      const event = { ...makeEvent(), pathParameters: { id: 'acc-1' } };
      await suspendTenant(event);
      expect(mockUpdateStatus).toHaveBeenCalledWith('acc-1', 'suspended');
    });

    it('validates session before suspending', async () => {
      const event = { ...makeEvent(), pathParameters: { id: 'acc-1' } };
      await suspendTenant(event);
      expect(mockValidateSession).toHaveBeenCalled();
    });

    it('throws UnauthorizedError when no session', async () => {
      mockValidateSession.mockRejectedValue(new UnauthorizedError('No admin session'));
      const event = { ...makeEvent({ headers: {} }), pathParameters: { id: 'acc-1' } };
      await expect(suspendTenant(event)).rejects.toThrow('No admin session');
    });

    it('throws ValidationError when no tenant ID', async () => {
      const event = { ...makeEvent(), pathParameters: {} };
      await expect(suspendTenant(event)).rejects.toThrow();
    });

    it('throws ValidationError when pathParameters is null', async () => {
      const event = { ...makeEvent(), pathParameters: null };
      await expect(suspendTenant(event)).rejects.toThrow();
    });

    it('audit logs the suspend action', async () => {
      const event = { ...makeEvent(), pathParameters: { id: 'acc-1' } };
      await suspendTenant(event);
      expect(mockAuditLog).toHaveBeenCalledWith('suspendTenant', { accountId: 'acc-1' });
    });

    it('enforces rate limit', async () => {
      const event = { ...makeEvent(), pathParameters: { id: 'acc-1' } };
      await suspendTenant(event);
      expect(mockEnforceAdminRateLimit).toHaveBeenCalledWith('10.0.0.1');
    });

    it('rejects with 429 when rate limit exceeded', async () => {
      mockEnforceAdminRateLimit.mockRejectedValue(new TooManyRequestsError(120, 30));
      const event = { ...makeEvent(), pathParameters: { id: 'acc-1' } };
      await expect(suspendTenant(event)).rejects.toThrow(TooManyRequestsError);
    });

    it('sets no-store cache control', async () => {
      const event = { ...makeEvent(), pathParameters: { id: 'acc-1' } };
      const res = await suspendTenant(event);
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('propagates repo errors', async () => {
      mockUpdateStatus.mockRejectedValue(new Error('DDB error'));
      const event = { ...makeEvent(), pathParameters: { id: 'acc-1' } };
      await expect(suspendTenant(event)).rejects.toThrow('DDB error');
    });
  });

  describe('reactivateTenant', () => {
    beforeEach(() => {
      mockUpdateStatus.mockResolvedValue({
        accountId: 'acc-1',
        plan: 'free',
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
      });
    });

    it('redirects to /admin/tenants/ui', async () => {
      const event = { ...makeEvent(), pathParameters: { id: 'acc-1' } };
      const res = await reactivateTenant(event);
      expect(res.statusCode).toBe(303);
      expect(res.headers.location).toBe('/admin/tenants/ui');
    });

    it('calls updateStatus with active', async () => {
      const event = { ...makeEvent(), pathParameters: { id: 'acc-1' } };
      await reactivateTenant(event);
      expect(mockUpdateStatus).toHaveBeenCalledWith('acc-1', 'active');
    });

    it('validates session before reactivating', async () => {
      const event = { ...makeEvent(), pathParameters: { id: 'acc-1' } };
      await reactivateTenant(event);
      expect(mockValidateSession).toHaveBeenCalled();
    });

    it('throws UnauthorizedError when no session', async () => {
      mockValidateSession.mockRejectedValue(new UnauthorizedError('No admin session'));
      const event = { ...makeEvent({ headers: {} }), pathParameters: { id: 'acc-1' } };
      await expect(reactivateTenant(event)).rejects.toThrow('No admin session');
    });

    it('throws ValidationError when no tenant ID', async () => {
      const event = { ...makeEvent(), pathParameters: {} };
      await expect(reactivateTenant(event)).rejects.toThrow();
    });

    it('audit logs the reactivate action', async () => {
      const event = { ...makeEvent(), pathParameters: { id: 'acc-1' } };
      await reactivateTenant(event);
      expect(mockAuditLog).toHaveBeenCalledWith('reactivateTenant', { accountId: 'acc-1' });
    });

    it('enforces rate limit', async () => {
      const event = { ...makeEvent(), pathParameters: { id: 'acc-1' } };
      await reactivateTenant(event);
      expect(mockEnforceAdminRateLimit).toHaveBeenCalledWith('10.0.0.1');
    });

    it('rejects with 429 when rate limit exceeded', async () => {
      mockEnforceAdminRateLimit.mockRejectedValue(new TooManyRequestsError(120, 30));
      const event = { ...makeEvent(), pathParameters: { id: 'acc-1' } };
      await expect(reactivateTenant(event)).rejects.toThrow(TooManyRequestsError);
    });

    it('sets no-store cache control', async () => {
      const event = { ...makeEvent(), pathParameters: { id: 'acc-1' } };
      const res = await reactivateTenant(event);
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('propagates repo errors', async () => {
      mockUpdateStatus.mockRejectedValue(new Error('DDB error'));
      const event = { ...makeEvent(), pathParameters: { id: 'acc-1' } };
      await expect(reactivateTenant(event)).rejects.toThrow('DDB error');
    });
  });

  describe('getAdminMetricsUI', () => {
    it('returns 200 with HTML metrics page', async () => {
      const res = await getAdminMetricsUI(makeEvent());
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(res.body).toContain('Metrics Dashboard');
    });

    it('includes CSP header', async () => {
      const res = await getAdminMetricsUI(makeEvent());
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    });

    it('sets no-store cache control', async () => {
      const res = await getAdminMetricsUI(makeEvent());
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('renders MRR value', async () => {
      const res = await getAdminMetricsUI(makeEvent());
      expect(res.body).toContain('$148');
      expect(res.body).toContain('MRR');
    });

    it('renders paying tenants count', async () => {
      const res = await getAdminMetricsUI(makeEvent());
      expect(res.body).toContain('>2<');
      expect(res.body).toContain('Paying Tenants');
    });

    it('renders total 402s', async () => {
      const res = await getAdminMetricsUI(makeEvent());
      expect(res.body).toContain('>42<');
      expect(res.body).toContain('402s Issued');
    });

    it('renders USDC settled', async () => {
      const res = await getAdminMetricsUI(makeEvent());
      expect(res.body).toContain('21.5');
      expect(res.body).toContain('USDC Settled');
    });

    it('renders fetches total', async () => {
      const res = await getAdminMetricsUI(makeEvent());
      expect(res.body).toContain('>7<');
      expect(res.body).toContain('Fetches Total');
    });

    it('renders fetch revenue', async () => {
      const res = await getAdminMetricsUI(makeEvent());
      expect(res.body).toContain('$0.0350');
      expect(res.body).toContain('Fetch Revenue');
    });

    it('renders fraud counts by window', async () => {
      const res = await getAdminMetricsUI(makeEvent());
      expect(res.body).toContain('>3<');
      expect(res.body).toContain('24h');
      expect(res.body).toContain('>10<');
      expect(res.body).toContain('7d');
      expect(res.body).toContain('>25<');
      expect(res.body).toContain('30d');
    });

    it('renders top tenants table', async () => {
      const res = await getAdminMetricsUI(makeEvent());
      expect(res.body).toContain('acc-1');
      expect(res.body).toContain('15');
      expect(res.body).toContain('Top 10 Tenants');
    });

    it('renders "No payments yet" when no tenants', async () => {
      mockGetDashboard.mockResolvedValue({
        mrr: 0,
        payingCount: 0,
        total402s: 0,
        totalUsdc: 0,
        fetchesTotal: 0,
        fetchRevenueUsdc: 0,
        fraudCounts: { h24: 0, h7d: 0, h30d: 0 },
        topTenants: [],
      });
      const res = await getAdminMetricsUI(makeEvent());
      expect(res.body).toContain('No payments yet');
    });

    it('validates session from cookie header', async () => {
      await getAdminMetricsUI(makeEvent());
      expect(mockValidateSession).toHaveBeenCalledWith('x402_admin_session=tok.sig');
    });

    it('reads Cookie header (capitalized)', async () => {
      const event = makeEvent({ headers: { Cookie: 'x402_admin_session=tok.sig' } });
      delete event.headers.cookie;
      await getAdminMetricsUI(event);
      expect(mockValidateSession).toHaveBeenCalledWith('x402_admin_session=tok.sig');
    });

    it('throws UnauthorizedError when no session', async () => {
      mockValidateSession.mockRejectedValue(new UnauthorizedError('No admin session'));
      await expect(getAdminMetricsUI(makeEvent({ headers: {} }))).rejects.toThrow(
        'No admin session',
      );
    });

    it('enforces rate limit before session validation', async () => {
      const order = [];
      mockEnforceAdminRateLimit.mockImplementation(async () => {
        order.push('rateLimit');
      });
      mockValidateSession.mockImplementation(async () => {
        order.push('session');
        return SESSION;
      });
      await getAdminMetricsUI(makeEvent());
      expect(order).toEqual(['rateLimit', 'session']);
    });

    it('rejects with 429 when rate limit exceeded', async () => {
      mockEnforceAdminRateLimit.mockRejectedValue(new TooManyRequestsError(120, 30));
      await expect(getAdminMetricsUI(makeEvent())).rejects.toThrow(TooManyRequestsError);
      expect(mockValidateSession).not.toHaveBeenCalled();
    });

    it('sets refreshed session cookie', async () => {
      const res = await getAdminMetricsUI(makeEvent());
      expect(res.headers['set-cookie']).toBe(SESSION.refreshCookie);
    });

    it('does not set cookie when no refreshCookie', async () => {
      mockValidateSession.mockResolvedValue({ role: 'admin', refreshCookie: null });
      const res = await getAdminMetricsUI(makeEvent());
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('audit logs the viewMetrics action', async () => {
      await getAdminMetricsUI(makeEvent());
      expect(mockAuditLog).toHaveBeenCalledWith('viewMetrics', {});
    });

    it('uses theme CSS', async () => {
      const res = await getAdminMetricsUI(makeEvent());
      expect(res.body).toContain('--accent');
      expect(res.body).toContain('--bg');
    });

    it('includes x-content-type-options header', async () => {
      const res = await getAdminMetricsUI(makeEvent());
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('escapes accountId in tenant table', async () => {
      mockGetDashboard.mockResolvedValue({
        mrr: 0,
        payingCount: 0,
        total402s: 0,
        totalUsdc: 0,
        fetchesTotal: 0,
        fetchRevenueUsdc: 0,
        fraudCounts: { h24: 0, h7d: 0, h30d: 0 },
        topTenants: [{ accountId: '<script>xss</script>', paymentCount: 1, totalUsdcMicro: 1000 }],
      });
      const res = await getAdminMetricsUI(makeEvent());
      expect(res.body).not.toContain('<script>xss');
      expect(res.body).toContain('&lt;script&gt;');
    });

    it('renders tenants link in header', async () => {
      const res = await getAdminMetricsUI(makeEvent());
      expect(res.body).toContain('/admin/tenants/ui');
      expect(res.body).toContain('Tenants');
    });

    it('renders logout link', async () => {
      const res = await getAdminMetricsUI(makeEvent());
      expect(res.body).toContain('/admin/logout');
      expect(res.body).toContain('Logout');
    });

    it('handles null headers gracefully', async () => {
      mockValidateSession.mockRejectedValue(new UnauthorizedError('No session'));
      const event = { headers: null, requestContext: { identity: { sourceIp: '10.0.0.1' } } };
      await expect(getAdminMetricsUI(event)).rejects.toThrow();
    });

    it('converts USDC micro to display in tenant table', async () => {
      mockGetDashboard.mockResolvedValue({
        mrr: 0,
        payingCount: 0,
        total402s: 0,
        totalUsdc: 0,
        fetchesTotal: 0,
        fetchRevenueUsdc: 0,
        fraudCounts: { h24: 0, h7d: 0, h30d: 0 },
        topTenants: [{ accountId: 'acc-1', paymentCount: 5, totalUsdcMicro: 5000000 }],
      });
      const res = await getAdminMetricsUI(makeEvent());
      expect(res.body).toContain('5.0000');
    });
  });
});

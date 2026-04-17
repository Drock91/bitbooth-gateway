import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockListAll = vi.hoisted(() => vi.fn());
const mockGetSecret = vi.hoisted(() => vi.fn());
const mockGetConfig = vi.hoisted(() => vi.fn());
const mockHmacSha256 = vi.hoisted(() => vi.fn());
const mockSha256 = vi.hoisted(() => vi.fn());
const mockSafeEquals = vi.hoisted(() => vi.fn());
const mockRecordEvent = vi.hoisted(() => vi.fn());

vi.mock('../../src/repositories/tenants.repo.js', () => ({
  tenantsRepo: { listAll: mockListAll },
}));
vi.mock('../../src/lib/secrets.js', () => ({
  getSecret: mockGetSecret,
}));
vi.mock('../../src/lib/config.js', () => ({
  getConfig: mockGetConfig,
}));
vi.mock('../../src/lib/crypto.js', () => ({
  sha256: mockSha256,
  hmacSha256: mockHmacSha256,
  safeEquals: mockSafeEquals,
}));
vi.mock('../../src/repositories/fraud.repo.js', () => ({
  fraudRepo: { recordEvent: mockRecordEvent },
}));

import { adminService } from '../../src/services/admin.service.js';

const SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:admin';
const SECRET_VALUE = 'admin-hash-value';
const TENANT = {
  accountId: '00000000-0000-0000-0000-000000000001',
  apiKeyHash: 'a'.repeat(64),
  plan: 'free',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('admin.service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetConfig.mockReturnValue({ secretArns: { adminApiKeyHash: SECRET_ARN } });
    mockGetSecret.mockResolvedValue(SECRET_VALUE);
    mockListAll.mockResolvedValue({ items: [], lastKey: null });
    mockHmacSha256.mockReturnValue('abcdef1234567890'.repeat(4));
    mockSha256.mockReturnValue('hashed-value');
    mockSafeEquals.mockReturnValue(true);
    mockRecordEvent.mockResolvedValue({});
  });

  it('exports COOKIE_NAME', () => {
    expect(adminService.COOKIE_NAME).toBe('x402_admin_session');
  });

  it('exports SESSION_TTL_MS as 15 minutes', () => {
    expect(adminService.SESSION_TTL_MS).toBe(900000);
  });

  describe('listTenants', () => {
    it('returns tenants from repo', async () => {
      mockListAll.mockResolvedValue({ items: [TENANT], lastKey: null });
      const result = await adminService.listTenants({ limit: 10 });
      expect(result.tenants).toEqual([TENANT]);
      expect(result.nextCursor).toBeNull();
    });

    it('passes limit to repo', async () => {
      await adminService.listTenants({ limit: 50 });
      expect(mockListAll).toHaveBeenCalledWith(50, undefined, undefined);
    });

    it('passes plan filter to repo', async () => {
      await adminService.listTenants({ limit: 20, plan: 'growth' });
      expect(mockListAll).toHaveBeenCalledWith(20, undefined, 'growth');
    });

    it('decodes cursor from base64url', async () => {
      const key = { accountId: 'abc' };
      const cursor = Buffer.from(JSON.stringify(key)).toString('base64url');
      await adminService.listTenants({ cursor });
      expect(mockListAll).toHaveBeenCalledWith(20, key, undefined);
    });

    it('encodes lastKey as base64url nextCursor', async () => {
      const lastKey = { accountId: 'next-id' };
      mockListAll.mockResolvedValue({ items: [TENANT], lastKey });
      const result = await adminService.listTenants();
      const decoded = JSON.parse(Buffer.from(result.nextCursor, 'base64url').toString());
      expect(decoded).toEqual(lastKey);
    });

    it('uses default limit of 20', async () => {
      await adminService.listTenants();
      expect(mockListAll).toHaveBeenCalledWith(20, undefined, undefined);
    });
  });

  describe('verifyAdminKey', () => {
    it('does not throw when hash matches', async () => {
      mockSha256.mockReturnValue('hashed');
      mockSafeEquals.mockReturnValue(true);
      await expect(adminService.verifyAdminKey('my-admin-key')).resolves.not.toThrow();
    });

    it('throws UnauthorizedError when hash does not match', async () => {
      mockSafeEquals.mockReturnValue(false);
      await expect(adminService.verifyAdminKey('bad-key')).rejects.toThrow(
        'Invalid admin credentials',
      );
    });

    it('throws UnauthorizedError when ARN is not configured', async () => {
      mockGetConfig.mockReturnValue({ secretArns: {} });
      await expect(adminService.verifyAdminKey('key')).rejects.toThrow(
        'Admin access not configured',
      );
    });

    it('hashes password with sha256', async () => {
      await adminService.verifyAdminKey('the-admin-key');
      expect(mockSha256).toHaveBeenCalledWith('the-admin-key');
    });

    it('uses safeEquals for constant-time comparison', async () => {
      mockSha256.mockReturnValue('abc');
      await adminService.verifyAdminKey('key');
      expect(mockSafeEquals).toHaveBeenCalledWith('abc', SECRET_VALUE);
    });

    it('fetches expected hash from Secrets Manager', async () => {
      await adminService.verifyAdminKey('key');
      expect(mockGetSecret).toHaveBeenCalledWith(SECRET_ARN);
    });
  });

  describe('createSessionCookie', () => {
    it('returns cookie with name, value, and options', async () => {
      const cookie = await adminService.createSessionCookie();
      expect(cookie.name).toBe('x402_admin_session');
      expect(cookie.value).toContain('.');
      expect(cookie.options).toContain('x402_admin_session=');
      expect(cookie.options).toContain('HttpOnly');
      expect(cookie.options).toContain('Secure');
      expect(cookie.options).toContain('SameSite=Strict');
      expect(cookie.options).toContain('Max-Age=900');
    });

    it('encodes admin role in payload', async () => {
      const cookie = await adminService.createSessionCookie();
      const encoded = cookie.value.split('.')[0];
      const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString());
      expect(payload.role).toBe('admin');
    });

    it('sets expiration to 15 minutes from now', async () => {
      const before = Date.now();
      const cookie = await adminService.createSessionCookie();
      const encoded = cookie.value.split('.')[0];
      const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString());
      expect(payload.exp).toBeGreaterThanOrEqual(before + 900000);
      expect(payload.exp).toBeLessThanOrEqual(Date.now() + 900000);
    });

    it('signs with HMAC-SHA256 from session secret', async () => {
      await adminService.createSessionCookie();
      expect(mockGetSecret).toHaveBeenCalledWith(SECRET_ARN);
      expect(mockHmacSha256).toHaveBeenCalledWith(SECRET_VALUE, expect.any(String));
    });

    it('throws when session secret is not configured', async () => {
      mockGetConfig.mockReturnValue({ secretArns: {} });
      await expect(adminService.createSessionCookie()).rejects.toThrow(
        'Admin session secret not configured',
      );
    });
  });

  describe('validateSession', () => {
    function makeCookieHeader(payload, sig) {
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const signature = sig ?? 'valid-sig';
      return `x402_admin_session=${encoded}.${signature}`;
    }

    it('returns role and refreshCookie for valid session', async () => {
      const payload = { role: 'admin', exp: Date.now() + 60000 };
      const header = makeCookieHeader(payload);
      mockHmacSha256.mockReturnValue('valid-sig');
      mockSafeEquals.mockReturnValue(true);

      const result = await adminService.validateSession(header);
      expect(result.role).toBe('admin');
      expect(result.refreshCookie).toContain('x402_admin_session=');
      expect(result.refreshCookie).toContain('Max-Age=900');
    });

    it('throws when cookieHeader is empty', async () => {
      await expect(adminService.validateSession('')).rejects.toThrow('No admin session');
    });

    it('throws when cookieHeader is null', async () => {
      await expect(adminService.validateSession(null)).rejects.toThrow('No admin session');
    });

    it('throws when cookie name not found', async () => {
      await expect(adminService.validateSession('other=value')).rejects.toThrow(
        'No admin session cookie',
      );
    });

    it('throws when session is malformed (no dot separator)', async () => {
      await expect(adminService.validateSession('x402_admin_session=nodot')).rejects.toThrow(
        'Malformed admin session',
      );
    });

    it('throws when HMAC signature does not match', async () => {
      const payload = { role: 'admin', exp: Date.now() + 60000 };
      const header = makeCookieHeader(payload, 'bad-sig');
      mockSafeEquals.mockReturnValue(false);

      await expect(adminService.validateSession(header)).rejects.toThrow(
        'Invalid admin session signature',
      );
    });

    it('throws when role is not admin', async () => {
      const payload = { role: 'user', exp: Date.now() + 60000 };
      const header = makeCookieHeader(payload);
      mockHmacSha256.mockReturnValue('valid-sig');
      mockSafeEquals.mockReturnValue(true);

      await expect(adminService.validateSession(header)).rejects.toThrow(
        'Invalid admin session role',
      );
    });

    it('throws when session is expired', async () => {
      const payload = { role: 'admin', exp: Date.now() - 1000 };
      const header = makeCookieHeader(payload);
      mockHmacSha256.mockReturnValue('valid-sig');
      mockSafeEquals.mockReturnValue(true);

      await expect(adminService.validateSession(header)).rejects.toThrow('Admin session expired');
    });

    it('throws when payload has no exp', async () => {
      const payload = { role: 'admin' };
      const header = makeCookieHeader(payload);
      mockHmacSha256.mockReturnValue('valid-sig');
      mockSafeEquals.mockReturnValue(true);

      await expect(adminService.validateSession(header)).rejects.toThrow('Admin session expired');
    });

    it('extracts cookie from multi-cookie header', async () => {
      const payload = { role: 'admin', exp: Date.now() + 60000 };
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const header = `other=abc; x402_admin_session=${encoded}.valid-sig; another=xyz`;
      mockHmacSha256.mockReturnValue('valid-sig');
      mockSafeEquals.mockReturnValue(true);

      const result = await adminService.validateSession(header);
      expect(result.role).toBe('admin');
    });

    it('returns refreshCookie with extended expiration (sliding timeout)', async () => {
      const payload = { role: 'admin', exp: Date.now() + 60000 };
      const header = makeCookieHeader(payload);
      mockHmacSha256.mockReturnValue('valid-sig');
      mockSafeEquals.mockReturnValue(true);

      const result = await adminService.validateSession(header);
      expect(result.refreshCookie).toContain('HttpOnly');
      expect(result.refreshCookie).toContain('Secure');
      expect(result.refreshCookie).toContain('SameSite=Strict');
    });
  });

  describe('clearCookie', () => {
    it('returns cookie string with Max-Age=0', () => {
      const result = adminService.clearCookie();
      expect(result).toContain('x402_admin_session=');
      expect(result).toContain('Max-Age=0');
      expect(result).toContain('HttpOnly');
      expect(result).toContain('Secure');
      expect(result).toContain('SameSite=Strict');
    });
  });

  describe('auditLog', () => {
    it('records event to fraud repo with admin accountId', async () => {
      await adminService.auditLog('login', { ip: '10.0.0.1' });
      expect(mockRecordEvent).toHaveBeenCalledWith({
        accountId: 'admin',
        eventType: 'admin.login',
        severity: 'info',
        details: { ip: '10.0.0.1' },
      });
    });

    it('prefixes action with admin.', async () => {
      await adminService.auditLog('listTenants', { limit: 20 });
      expect(mockRecordEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'admin.listTenants' }),
      );
    });

    it('propagates repo errors', async () => {
      mockRecordEvent.mockRejectedValue(new Error('DDB unavailable'));
      await expect(adminService.auditLog('action', {})).rejects.toThrow('DDB unavailable');
    });
  });

  describe('getRevenueStats', () => {
    it('returns 0 MRR for empty tenants table', async () => {
      mockListAll.mockResolvedValue({ items: [], lastKey: null });
      const stats = await adminService.getRevenueStats();
      expect(stats).toEqual({ mrr: 0, payingCount: 0 });
    });

    it('computes MRR from paying plans', async () => {
      mockListAll.mockResolvedValue({
        items: [
          { ...TENANT, plan: 'starter', status: 'active' },
          {
            ...TENANT,
            accountId: '00000000-0000-0000-0000-000000000002',
            plan: 'growth',
            status: 'active',
          },
        ],
        lastKey: null,
      });
      const stats = await adminService.getRevenueStats();
      expect(stats.mrr).toBe(148);
      expect(stats.payingCount).toBe(2);
    });

    it('excludes suspended tenants from MRR', async () => {
      mockListAll.mockResolvedValue({
        items: [
          { ...TENANT, plan: 'starter', status: 'suspended' },
          {
            ...TENANT,
            accountId: '00000000-0000-0000-0000-000000000002',
            plan: 'growth',
            status: 'active',
          },
        ],
        lastKey: null,
      });
      const stats = await adminService.getRevenueStats();
      expect(stats.mrr).toBe(99);
      expect(stats.payingCount).toBe(1);
    });

    it('excludes free plan from MRR', async () => {
      mockListAll.mockResolvedValue({
        items: [{ ...TENANT, plan: 'free', status: 'active' }],
        lastKey: null,
      });
      const stats = await adminService.getRevenueStats();
      expect(stats).toEqual({ mrr: 0, payingCount: 0 });
    });

    it('paginates through all tenants', async () => {
      mockListAll
        .mockResolvedValueOnce({
          items: [{ ...TENANT, plan: 'scale', status: 'active' }],
          lastKey: { accountId: 'cursor-1' },
        })
        .mockResolvedValueOnce({
          items: [
            {
              ...TENANT,
              accountId: '00000000-0000-0000-0000-000000000002',
              plan: 'starter',
              status: 'active',
            },
          ],
          lastKey: null,
        });

      const stats = await adminService.getRevenueStats();
      expect(stats.mrr).toBe(348);
      expect(stats.payingCount).toBe(2);
      expect(mockListAll).toHaveBeenCalledTimes(2);
      expect(mockListAll).toHaveBeenCalledWith(100, undefined);
      expect(mockListAll).toHaveBeenCalledWith(100, { accountId: 'cursor-1' });
    });

    it('treats missing status as active', async () => {
      mockListAll.mockResolvedValue({
        items: [{ ...TENANT, plan: 'starter' }],
        lastKey: null,
      });
      const stats = await adminService.getRevenueStats();
      expect(stats.mrr).toBe(49);
      expect(stats.payingCount).toBe(1);
    });

    it('treats unknown plan as free', async () => {
      mockListAll.mockResolvedValue({
        items: [{ ...TENANT, plan: 'enterprise', status: 'active' }],
        lastKey: null,
      });
      const stats = await adminService.getRevenueStats();
      expect(stats).toEqual({ mrr: 0, payingCount: 0 });
    });
  });
});

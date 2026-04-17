import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetByApiKeyHash = vi.fn();
const mockGetSecret = vi.fn();

vi.mock('../../src/repositories/tenants.repo.js', () => ({
  tenantsRepo: { getByApiKeyHash: (...args) => mockGetByApiKeyHash(...args) },
}));
vi.mock('../../src/lib/secrets.js', () => ({
  getSecret: (...args) => mockGetSecret(...args),
}));
vi.mock('../../src/lib/config.js', () => ({
  getConfig: () => ({
    awsRegion: 'us-east-1',
    secretArns: { adminApiKeyHash: 'arn:aws:secretsmanager:us-east-1:123:secret:admin' },
  }),
}));

import { portalService } from '../../src/services/portal.service.js';

const SECRET = 'test-session-secret-value';
const TENANT = { accountId: 'acc-1', plan: 'starter', apiKeyHash: 'abc', createdAt: '2026-01-01' };

describe('portalService', () => {
  beforeEach(() => {
    mockGetByApiKeyHash.mockReset();
    mockGetSecret.mockReset();
    mockGetSecret.mockResolvedValue(SECRET);
  });

  describe('verifyApiKey', () => {
    it('returns tenant when API key hash matches', async () => {
      mockGetByApiKeyHash.mockResolvedValueOnce(TENANT);
      const result = await portalService.verifyApiKey('x402_abc123');
      expect(result).toEqual(TENANT);
      expect(mockGetByApiKeyHash).toHaveBeenCalledOnce();
      const hash = mockGetByApiKeyHash.mock.calls[0][0];
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('throws UnauthorizedError when no tenant found', async () => {
      mockGetByApiKeyHash.mockResolvedValueOnce(null);
      await expect(portalService.verifyApiKey('bad-key')).rejects.toThrow('Invalid API key');
    });

    it('propagates repo errors', async () => {
      mockGetByApiKeyHash.mockRejectedValueOnce(new Error('ddb down'));
      await expect(portalService.verifyApiKey('key')).rejects.toThrow('ddb down');
    });
  });

  describe('createSessionCookie', () => {
    it('returns cookie with HMAC-signed payload', async () => {
      const cookie = await portalService.createSessionCookie('acc-1', 'starter');
      expect(cookie.name).toBe('x402_session');
      expect(cookie.value).toMatch(/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/);
      expect(cookie.options).toContain('HttpOnly');
      expect(cookie.options).toContain('Secure');
      expect(cookie.options).toContain('SameSite=Strict');
      expect(cookie.options).toContain('Path=/');
      expect(cookie.options).toContain('Max-Age=900');
    });

    it('encodes accountId and plan in payload', async () => {
      const cookie = await portalService.createSessionCookie('acc-1', 'growth');
      const [encoded] = cookie.value.split('.');
      const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString());
      expect(payload.accountId).toBe('acc-1');
      expect(payload.plan).toBe('growth');
      expect(payload.exp).toBeGreaterThan(Date.now());
    });

    it('fetches secret from Secrets Manager', async () => {
      await portalService.createSessionCookie('acc-1', 'free');
      expect(mockGetSecret).toHaveBeenCalledWith(
        'arn:aws:secretsmanager:us-east-1:123:secret:admin',
      );
    });
  });

  describe('validateSession', () => {
    async function makeValidCookie(accountId = 'acc-1', plan = 'starter') {
      const cookie = await portalService.createSessionCookie(accountId, plan);
      return `x402_session=${cookie.value}`;
    }

    it('returns accountId and plan for valid session', async () => {
      const header = await makeValidCookie('acc-1', 'growth');
      const session = await portalService.validateSession(header);
      expect(session.accountId).toBe('acc-1');
      expect(session.plan).toBe('growth');
    });

    it('handles cookie among multiple cookies', async () => {
      const cookie = await portalService.createSessionCookie('acc-1', 'free');
      const header = `other=foo; x402_session=${cookie.value}; bar=baz`;
      const session = await portalService.validateSession(header);
      expect(session.accountId).toBe('acc-1');
    });

    it('throws when no cookie header', async () => {
      await expect(portalService.validateSession(null)).rejects.toThrow('No session');
    });

    it('throws when session cookie missing', async () => {
      await expect(portalService.validateSession('other=foo')).rejects.toThrow('No session cookie');
    });

    it('throws when cookie is malformed (no dot)', async () => {
      await expect(portalService.validateSession('x402_session=nodot')).rejects.toThrow(
        'Malformed session',
      );
    });

    it('throws when signature is invalid', async () => {
      const cookie = await portalService.createSessionCookie('acc-1', 'free');
      const tampered = `x402_session=${cookie.value.split('.')[0]}.badbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbad`;
      await expect(portalService.validateSession(tampered)).rejects.toThrow(
        'Invalid session signature',
      );
    });

    it('throws when session is expired', async () => {
      const { hmacSha256 } = await import('../../src/lib/crypto.js');
      const payload = JSON.stringify({ accountId: 'acc-1', plan: 'free', exp: Date.now() - 1000 });
      const encoded = Buffer.from(payload).toString('base64url');
      const sig = hmacSha256(SECRET, encoded);
      const header = `x402_session=${encoded}.${sig}`;
      await expect(portalService.validateSession(header)).rejects.toThrow('Session expired');
    });
  });

  describe('clearCookie', () => {
    it('returns Set-Cookie header that expires the cookie', () => {
      const header = portalService.clearCookie();
      expect(header).toContain('x402_session=');
      expect(header).toContain('Max-Age=0');
      expect(header).toContain('HttpOnly');
      expect(header).toContain('Secure');
      expect(header).toContain('SameSite=Strict');
    });
  });

  describe('constants', () => {
    it('exposes COOKIE_NAME', () => {
      expect(portalService.COOKIE_NAME).toBe('x402_session');
    });

    it('exposes SESSION_TTL_MS of 15 minutes', () => {
      expect(portalService.SESSION_TTL_MS).toBe(15 * 60 * 1000);
    });
  });
});

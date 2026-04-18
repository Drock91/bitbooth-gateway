import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSummary = vi.hoisted(() => vi.fn());
const mockValidateSession = vi.hoisted(() => vi.fn());
const mockEnforceAdminRateLimit = vi.hoisted(() => vi.fn());

vi.mock('../../src/services/earnings.service.js', () => ({
  earningsService: { summary: mockSummary },
}));

vi.mock('../../src/services/admin.service.js', () => ({
  adminService: { validateSession: mockValidateSession },
}));

vi.mock('../../src/middleware/rate-limit.middleware.js', () => ({
  enforceAdminRateLimit: mockEnforceAdminRateLimit,
  rateLimitHeaders: () => ({ 'ratelimit-limit': '30' }),
}));

vi.mock('../../src/middleware/error.middleware.js', () => ({
  jsonResponse: (status, body) => ({
    statusCode: status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }),
}));

vi.mock('../../src/static/earnings.html.js', () => ({
  renderEarningsPage: () => '<html>mock</html>',
}));

vi.mock('../../src/lib/stage-prefix.js', () => ({
  stagePrefix: () => '',
}));

import { getEarningsJson, getEarningsHtml } from '../../src/controllers/earnings.controller.js';

function fakeEvent(mode) {
  return {
    queryStringParameters: mode ? { mode } : {},
    headers: { cookie: 'session=abc' },
    requestContext: { identity: { sourceIp: '1.2.3.4' } },
  };
}

function fakeSummary(mode) {
  return {
    generatedAt: new Date().toISOString(),
    mode,
    totals: { payments: 0, uniqueAgents: 0, last24h: 0, last7d: 0, last30d: 0 },
    byChain: [],
    byAgent: [],
    byResource: [],
    sparkline: [],
    recent: [],
  };
}

describe('earnings.controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateSession.mockResolvedValue({ refreshCookie: null });
    mockEnforceAdminRateLimit.mockResolvedValue({ remaining: 29, limit: 30, resetAt: Date.now() + 3600000 });
  });

  describe('getEarningsJson', () => {
    it('defaults to mode=real when no query param', async () => {
      mockSummary.mockResolvedValue(fakeSummary('real'));
      await getEarningsJson(fakeEvent());
      expect(mockSummary).toHaveBeenCalledWith({ mode: 'real' });
    });

    it('passes mode=testnet from query param', async () => {
      mockSummary.mockResolvedValue(fakeSummary('testnet'));
      await getEarningsJson(fakeEvent('testnet'));
      expect(mockSummary).toHaveBeenCalledWith({ mode: 'testnet' });
    });

    it('passes mode=all from query param', async () => {
      mockSummary.mockResolvedValue(fakeSummary('all'));
      await getEarningsJson(fakeEvent('all'));
      expect(mockSummary).toHaveBeenCalledWith({ mode: 'all' });
    });

    it('defaults invalid mode values to real', async () => {
      mockSummary.mockResolvedValue(fakeSummary('real'));
      await getEarningsJson(fakeEvent('invalid'));
      expect(mockSummary).toHaveBeenCalledWith({ mode: 'real' });
    });

    it('returns 200 with summary body', async () => {
      const summary = fakeSummary('real');
      mockSummary.mockResolvedValue(summary);
      const res = await getEarningsJson(fakeEvent());
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.mode).toBe('real');
    });

    it('includes rate limit headers', async () => {
      mockSummary.mockResolvedValue(fakeSummary('real'));
      const res = await getEarningsJson(fakeEvent());
      expect(res.headers['ratelimit-limit']).toBe('30');
    });

    it('includes set-cookie when session refreshes', async () => {
      mockValidateSession.mockResolvedValue({ refreshCookie: 'session=new; Path=/' });
      mockSummary.mockResolvedValue(fakeSummary('real'));
      const res = await getEarningsJson(fakeEvent());
      expect(res.headers['set-cookie']).toBe('session=new; Path=/');
    });

    it('handles null queryStringParameters', async () => {
      mockSummary.mockResolvedValue(fakeSummary('real'));
      await getEarningsJson({ headers: { cookie: 'session=abc' }, requestContext: { identity: { sourceIp: '1.2.3.4' } } });
      expect(mockSummary).toHaveBeenCalledWith({ mode: 'real' });
    });
  });

  describe('getEarningsHtml', () => {
    it('returns 200 with HTML content type', async () => {
      const res = await getEarningsHtml(fakeEvent());
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    });

    it('returns cache-control no-store', async () => {
      const res = await getEarningsHtml(fakeEvent());
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('includes CSP header', async () => {
      const res = await getEarningsHtml(fakeEvent());
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSignup = vi.fn();
const mockEnforceSignupRateLimit = vi.fn();
const mockDemoSignup = vi.fn();
const mockLoggerInfo = vi.fn();

vi.mock('../../src/services/dashboard.service.js', () => ({
  dashboardService: {
    signup: (...args) => mockSignup(...args),
  },
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
vi.mock('../../src/lib/metrics.js', () => ({
  demoSignup: (...args) => mockDemoSignup(...args),
}));
vi.mock('../../src/lib/logger.js', () => ({
  logger: { info: (...args) => mockLoggerInfo(...args), warn: vi.fn(), error: vi.fn() },
}));

import { postDemoSignup } from '../../src/controllers/demo.controller.js';
import { TooManyRequestsError, ValidationError } from '../../src/lib/errors.js';

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

function makeEvent({ body, ip = '1.2.3.4' } = {}) {
  return {
    requestContext: { identity: { sourceIp: ip } },
    headers: {},
    body: body === undefined ? JSON.stringify({ email: 'user@example.com' }) : body,
  };
}

describe('demo.controller', () => {
  beforeEach(() => {
    mockSignup.mockReset();
    mockEnforceSignupRateLimit.mockReset();
    mockDemoSignup.mockReset();
    mockLoggerInfo.mockReset();
    mockEnforceSignupRateLimit.mockResolvedValue({ limit: 5, remaining: 4, reset: 720 });
    mockSignup.mockResolvedValue({ accountId: VALID_UUID, apiKey: 'x402_testkey', plan: 'free' });
  });

  describe('postDemoSignup', () => {
    it('returns 200 JSON with accountId + apiKey on success', async () => {
      const res = await postDemoSignup(makeEvent());
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/json');
      const body = JSON.parse(res.body);
      expect(body.accountId).toBe(VALID_UUID);
      expect(body.apiKey).toBe('x402_testkey');
      expect(body.plan).toBe('free');
      expect(body.docsUrl).toBe('/docs');
      expect(body.dashboardUrl).toBe(`/dashboard?accountId=${VALID_UUID}`);
      expect(body.message).toContain('Save this');
    });

    it('enforces signup rate limit with client IP', async () => {
      await postDemoSignup(makeEvent({ ip: '9.9.9.9' }));
      expect(mockEnforceSignupRateLimit).toHaveBeenCalledWith('9.9.9.9');
    });

    it('returns ratelimit headers on success', async () => {
      const res = await postDemoSignup(makeEvent());
      expect(res.headers['ratelimit-limit']).toBe('5');
      expect(res.headers['ratelimit-remaining']).toBe('4');
      expect(res.headers['ratelimit-reset']).toBe('720');
    });

    it('throws TooManyRequestsError when rate limit exhausted', async () => {
      mockEnforceSignupRateLimit.mockRejectedValueOnce(new TooManyRequestsError(720, 5));
      await expect(postDemoSignup(makeEvent())).rejects.toThrow(TooManyRequestsError);
    });

    it('throws ValidationError for missing email', async () => {
      await expect(postDemoSignup(makeEvent({ body: '{}' }))).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for malformed email', async () => {
      await expect(
        postDemoSignup(makeEvent({ body: JSON.stringify({ email: 'not-email' }) })),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for malformed JSON body', async () => {
      await expect(postDemoSignup(makeEvent({ body: 'not-json' }))).rejects.toThrow(
        ValidationError,
      );
    });

    it('throws ValidationError for null body', async () => {
      await expect(postDemoSignup(makeEvent({ body: null }))).rejects.toThrow(ValidationError);
    });

    it('does NOT call signup() when email is invalid', async () => {
      await expect(postDemoSignup(makeEvent({ body: '{}' }))).rejects.toThrow();
      expect(mockSignup).not.toHaveBeenCalled();
    });

    it('does NOT call signup() when rate limited', async () => {
      mockEnforceSignupRateLimit.mockRejectedValueOnce(new TooManyRequestsError(720, 5));
      await expect(postDemoSignup(makeEvent())).rejects.toThrow();
      expect(mockSignup).not.toHaveBeenCalled();
    });

    it('emits demo.signup metric with emailDomain', async () => {
      await postDemoSignup(makeEvent({ body: JSON.stringify({ email: 'alice@ACME.co' }) }));
      expect(mockDemoSignup).toHaveBeenCalledWith({
        accountId: VALID_UUID,
        emailDomain: 'acme.co',
      });
    });

    it('logs the full email for outreach via logger.info', async () => {
      await postDemoSignup(makeEvent({ body: JSON.stringify({ email: 'bob@example.org' }) }));
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'demo.signup',
          email: 'bob@example.org',
          accountId: VALID_UUID,
        }),
        'demo signup succeeded',
      );
    });

    it('trims whitespace around email before validation', async () => {
      const res = await postDemoSignup(
        makeEvent({ body: JSON.stringify({ email: '  user@example.com  ' }) }),
      );
      expect(res.statusCode).toBe(200);
    });

    it('extracts IP from x-forwarded-for when sourceIp absent', async () => {
      await postDemoSignup({
        headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' },
        body: JSON.stringify({ email: 'u@e.co' }),
      });
      expect(mockEnforceSignupRateLimit).toHaveBeenCalledWith('10.0.0.1');
    });

    it('uses "unknown" when no IP info available', async () => {
      await postDemoSignup({ body: JSON.stringify({ email: 'u@e.co' }) });
      expect(mockEnforceSignupRateLimit).toHaveBeenCalledWith('unknown');
    });

    it('propagates service errors', async () => {
      mockSignup.mockRejectedValueOnce(new Error('ddb write failed'));
      await expect(postDemoSignup(makeEvent())).rejects.toThrow('ddb write failed');
    });

    it('handles email with no @ by failing validation', async () => {
      await expect(
        postDemoSignup(makeEvent({ body: JSON.stringify({ email: 'noatsign' }) })),
      ).rejects.toThrow(ValidationError);
    });
  });
});

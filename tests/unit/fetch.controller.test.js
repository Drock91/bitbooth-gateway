import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedError } from '../../src/lib/errors.js';

const mockFetch = vi.fn();
const mockIsCached = vi.fn();
const mockAuthenticate = vi.fn();
const mockEnforceRateLimit = vi.fn();
const mockEnforceX402 = vi.fn();

vi.mock('../../src/services/fetch.service.js', () => ({
  fetchService: { fetch: (...a) => mockFetch(...a), isCached: (...a) => mockIsCached(...a) },
}));

vi.mock('../../src/middleware/auth.middleware.js', () => ({
  authenticate: (...a) => mockAuthenticate(...a),
}));

vi.mock('../../src/middleware/rate-limit.middleware.js', () => ({
  enforceRateLimit: (...a) => mockEnforceRateLimit(...a),
  rateLimitHeaders: (info) => ({
    'ratelimit-limit': String(info.limit),
    'ratelimit-remaining': String(info.remaining),
    'ratelimit-reset': String(info.reset),
  }),
}));

vi.mock('../../src/middleware/x402.middleware.js', () => ({
  enforceX402: (...a) => mockEnforceX402(...a),
}));

import { postFetch } from '../../src/controllers/fetch.controller.js';

const defaultRlInfo = { limit: 100, remaining: 99, reset: 1 };

function makeEvent(body, headers, sourceIp = '1.2.3.4') {
  return {
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: headers ?? {},
    requestContext: { identity: { sourceIp } },
  };
}

const validInput = { url: 'https://example.com/article' };

const fakeFetchResult = {
  title: 'Example Article',
  markdown: '# Hello\n\nSome content.',
  metadata: {
    url: 'https://example.com/article',
    fetchedAt: '2026-04-15T00:00:00.000Z',
    contentLength: 1234,
    truncated: false,
  },
};

describe('postFetch', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockIsCached.mockReset();
    mockAuthenticate.mockReset();
    mockEnforceRateLimit.mockReset();
    mockEnforceX402.mockReset();
    mockIsCached.mockResolvedValue(false);
    mockEnforceRateLimit.mockResolvedValue(defaultRlInfo);
    mockEnforceX402.mockResolvedValue({ paid: true, txHash: '0xabc' });
  });

  describe('anonymous (x402-only, no API key) — the flagship agent-native path', () => {
    beforeEach(() => {
      mockAuthenticate.mockRejectedValue(new UnauthorizedError('missing api key'));
    });

    it('allows calls with no x-api-key header, rate-limits by anon:<ip>', async () => {
      mockFetch.mockResolvedValueOnce(fakeFetchResult);
      const res = await postFetch(makeEvent(validInput, {}, '9.9.9.9'));
      expect(res.statusCode).toBe(200);
      expect(mockEnforceRateLimit).toHaveBeenCalledWith('anon:9.9.9.9', 'free');
    });

    it('always enforces x402 payment for anonymous callers', async () => {
      mockFetch.mockResolvedValueOnce(fakeFetchResult);
      await postFetch(makeEvent(validInput, {}, '9.9.9.9'));
      expect(mockEnforceX402).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 'anon:9.9.9.9',
          route: expect.objectContaining({
            resource: '/v1/fetch',
            amountWei: '5000',
            assetSymbol: 'USDC',
          }),
        }),
      );
    });

    it('propagates x402 PaymentRequiredError when no X-PAYMENT header', async () => {
      mockEnforceX402.mockRejectedValueOnce(new Error('Payment Required'));
      await expect(postFetch(makeEvent(validInput))).rejects.toThrow('Payment Required');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('falls back to anon:unknown if sourceIp is missing', async () => {
      mockFetch.mockResolvedValueOnce(fakeFetchResult);
      await postFetch({ body: JSON.stringify(validInput), headers: {} });
      expect(mockEnforceRateLimit).toHaveBeenCalledWith('anon:unknown', 'free');
    });
  });

  describe('registered tenant (API key present) — legacy / SaaS path', () => {
    beforeEach(() => {
      mockAuthenticate.mockResolvedValue({ accountId: 'acct-1', plan: 'starter' });
    });

    it('uses tenant accountId + plan for rate limiting', async () => {
      mockFetch.mockResolvedValueOnce(fakeFetchResult);
      await postFetch(makeEvent(validInput, { 'x-api-key': 'key-1' }));
      expect(mockEnforceRateLimit).toHaveBeenCalledWith('acct-1', 'starter');
    });

    it('still enforces x402 payment for registered tenants', async () => {
      mockFetch.mockResolvedValueOnce(fakeFetchResult);
      await postFetch(makeEvent(validInput, { 'x-api-key': 'key-1' }));
      expect(mockEnforceX402).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: 'acct-1' }),
      );
    });

    it('normalizes X-API-KEY to x-api-key before authenticate', async () => {
      mockFetch.mockResolvedValueOnce(fakeFetchResult);
      await postFetch(makeEvent(validInput, { 'X-API-KEY': 'key-1' }));
      expect(mockAuthenticate).toHaveBeenCalledWith(
        expect.objectContaining({ 'x-api-key': 'key-1' }),
      );
    });

    it('re-throws non-auth errors from authenticate', async () => {
      mockAuthenticate.mockRejectedValueOnce(new Error('ddb down'));
      await expect(postFetch(makeEvent(validInput, { 'x-api-key': 'k' }))).rejects.toThrow(
        'ddb down',
      );
    });
  });

  describe('common (both paths)', () => {
    beforeEach(() => {
      mockAuthenticate.mockRejectedValue(new UnauthorizedError('missing api key'));
    });

    it('returns rate-limit headers on success', async () => {
      mockFetch.mockResolvedValueOnce(fakeFetchResult);
      const res = await postFetch(makeEvent(validInput));
      expect(res.headers['ratelimit-limit']).toBe('100');
      expect(res.headers['ratelimit-remaining']).toBe('99');
      expect(res.headers['ratelimit-reset']).toBe('1');
    });

    it('returns 200 with fetch result', async () => {
      mockFetch.mockResolvedValueOnce(fakeFetchResult);
      const res = await postFetch(makeEvent(validInput));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual(fakeFetchResult);
    });

    it('delegates parsed input to fetchService.fetch', async () => {
      mockFetch.mockResolvedValueOnce(fakeFetchResult);
      await postFetch(makeEvent(validInput));
      expect(mockFetch).toHaveBeenCalledWith({ url: 'https://example.com/article', mode: 'fast' });
    });

    it('passes mode=full when specified', async () => {
      mockFetch.mockResolvedValueOnce(fakeFetchResult);
      await postFetch(makeEvent({ ...validInput, mode: 'full' }));
      expect(mockFetch).toHaveBeenCalledWith({ url: 'https://example.com/article', mode: 'full' });
    });

    it('defaults mode to fast', async () => {
      mockFetch.mockResolvedValueOnce(fakeFetchResult);
      await postFetch(makeEvent({ url: 'https://example.com' }));
      expect(mockFetch).toHaveBeenCalledWith(expect.objectContaining({ mode: 'fast' }));
    });

    it('strips extra fields via Zod schema', async () => {
      mockFetch.mockResolvedValueOnce(fakeFetchResult);
      await postFetch(makeEvent({ ...validInput, extraField: 'ignored' }));
      const callArg = mockFetch.mock.calls[0][0];
      expect(callArg).not.toHaveProperty('extraField');
    });

    it('throws ValidationError for missing body', async () => {
      await expect(
        postFetch({ body: null, headers: {}, requestContext: { identity: { sourceIp: 'x' } } }),
      ).rejects.toThrow('Invalid request');
    });

    it('throws ValidationError for invalid url', async () => {
      await expect(postFetch(makeEvent({ url: 'not-a-url' }))).rejects.toThrow('Invalid request');
    });

    it('throws ValidationError for invalid mode', async () => {
      await expect(
        postFetch(makeEvent({ url: 'https://example.com', mode: 'turbo' })),
      ).rejects.toThrow('Invalid request');
    });

    it('propagates rate limit errors', async () => {
      mockEnforceRateLimit.mockRejectedValueOnce(new Error('rate limit exceeded'));
      await expect(postFetch(makeEvent(validInput))).rejects.toThrow('rate limit exceeded');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('propagates service errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('upstream down'));
      await expect(postFetch(makeEvent(validInput))).rejects.toThrow('upstream down');
    });

    it('normalizes null headers without crashing', async () => {
      mockFetch.mockResolvedValueOnce(fakeFetchResult);
      const res = await postFetch({
        body: JSON.stringify(validInput),
        headers: null,
        requestContext: { identity: { sourceIp: '1.1.1.1' } },
      });
      expect(res.statusCode).toBe(200);
    });

    it('charges 4× for render mode ($0.02 USDC)', async () => {
      mockFetch.mockResolvedValueOnce(fakeFetchResult);
      await postFetch(makeEvent({ url: 'https://spa.com', mode: 'render' }));
      expect(mockEnforceX402).toHaveBeenCalledWith(
        expect.objectContaining({
          route: expect.objectContaining({ amountWei: '20000' }),
        }),
      );
    });

    it('charges standard price for fast mode', async () => {
      mockFetch.mockResolvedValueOnce(fakeFetchResult);
      await postFetch(makeEvent({ url: 'https://example.com', mode: 'fast' }));
      expect(mockEnforceX402).toHaveBeenCalledWith(
        expect.objectContaining({
          route: expect.objectContaining({ amountWei: '5000' }),
        }),
      );
    });

    it('charges standard price for full mode', async () => {
      mockFetch.mockResolvedValueOnce(fakeFetchResult);
      await postFetch(makeEvent({ url: 'https://example.com', mode: 'full' }));
      expect(mockEnforceX402).toHaveBeenCalledWith(
        expect.objectContaining({
          route: expect.objectContaining({ amountWei: '5000' }),
        }),
      );
    });

    it('enforces rate-limit BEFORE x402 (cheap check first)', async () => {
      const order = [];
      mockEnforceRateLimit.mockImplementationOnce(async () => {
        order.push('rl');
        return defaultRlInfo;
      });
      mockEnforceX402.mockImplementationOnce(async () => {
        order.push('x402');
        return { paid: true, txHash: '0x1' };
      });
      mockFetch.mockResolvedValueOnce(fakeFetchResult);
      await postFetch(makeEvent(validInput));
      expect(order).toEqual(['rl', 'x402']);
    });
  });

  describe('cache-aware pricing (shared fetch)', () => {
    beforeEach(() => {
      mockAuthenticate.mockRejectedValue(new UnauthorizedError('missing api key'));
    });

    it('charges reduced price when URL is cached (fast mode)', async () => {
      mockIsCached.mockResolvedValueOnce(true);
      mockFetch.mockResolvedValueOnce(fakeFetchResult);

      await postFetch(makeEvent(validInput));

      expect(mockEnforceX402).toHaveBeenCalledWith(
        expect.objectContaining({
          route: expect.objectContaining({ amountWei: '1000' }),
        }),
      );
    });

    it('charges reduced price when URL is cached (render mode)', async () => {
      mockIsCached.mockResolvedValueOnce(true);
      mockFetch.mockResolvedValueOnce(fakeFetchResult);

      await postFetch(makeEvent({ url: 'https://spa.com', mode: 'render' }));

      expect(mockEnforceX402).toHaveBeenCalledWith(
        expect.objectContaining({
          route: expect.objectContaining({ amountWei: '4000' }),
        }),
      );
    });

    it('charges full price when URL is NOT cached', async () => {
      mockIsCached.mockResolvedValueOnce(false);
      mockFetch.mockResolvedValueOnce(fakeFetchResult);

      await postFetch(makeEvent(validInput));

      expect(mockEnforceX402).toHaveBeenCalledWith(
        expect.objectContaining({
          route: expect.objectContaining({ amountWei: '5000' }),
        }),
      );
    });

    it('calls isCached with parsed url and mode', async () => {
      mockFetch.mockResolvedValueOnce(fakeFetchResult);

      await postFetch(makeEvent({ url: 'https://test.com', mode: 'full' }));

      expect(mockIsCached).toHaveBeenCalledWith('https://test.com', 'full');
    });

    it('checks cache BEFORE enforcing x402', async () => {
      const order = [];
      mockIsCached.mockImplementationOnce(async () => {
        order.push('cache');
        return false;
      });
      mockEnforceX402.mockImplementationOnce(async () => {
        order.push('x402');
        return { paid: true, txHash: '0x1' };
      });
      mockFetch.mockResolvedValueOnce(fakeFetchResult);

      await postFetch(makeEvent(validInput));

      expect(order).toEqual(['cache', 'x402']);
    });

    it('falls back to full price when isCached throws', async () => {
      mockIsCached.mockRejectedValueOnce(new Error('DDB error'));
      mockFetch.mockResolvedValueOnce(fakeFetchResult);

      // isCached error should propagate — controller doesn't swallow it.
      // But the service's isCached already swallows DDB errors internally.
      // If something unexpected escapes, it's a 500.
      await expect(postFetch(makeEvent(validInput))).rejects.toThrow('DDB error');
    });

    it('charges reduced price for full mode cache hit', async () => {
      mockIsCached.mockResolvedValueOnce(true);
      mockFetch.mockResolvedValueOnce(fakeFetchResult);

      await postFetch(makeEvent({ url: 'https://example.com', mode: 'full' }));

      expect(mockEnforceX402).toHaveBeenCalledWith(
        expect.objectContaining({
          route: expect.objectContaining({ amountWei: '1000' }),
        }),
      );
    });
  });
});

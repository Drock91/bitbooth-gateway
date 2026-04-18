import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetBest = vi.fn();
const mockAuthenticate = vi.fn();
const mockEnforceRateLimit = vi.fn();

vi.mock('../../src/services/quote.service.js', () => ({
  quoteService: { getBest: (...a) => mockGetBest(...a) },
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

vi.mock('../../src/validators/exchange.schema.js', async () => {
  const { z } = await import('zod');
  return {
    QuoteRequest: z.object({
      fiatCurrency: z.enum(['USD', 'EUR', 'GBP']),
      fiatAmount: z.number().positive().max(50000),
      cryptoAsset: z.enum(['USDC', 'XRP', 'ETH']),
      exchange: z.string().min(1).optional(),
    }),
  };
});

import { postQuote } from '../../src/controllers/quote.controller.js';

const defaultRlInfo = { limit: 100, remaining: 99, reset: 1 };

function makeEvent(body, headers = { 'x-api-key': 'test-key-123' }) {
  return {
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers,
  };
}

const validInput = {
  fiatCurrency: 'USD',
  fiatAmount: 100,
  cryptoAsset: 'USDC',
};

describe('postQuote', () => {
  beforeEach(() => {
    mockGetBest.mockReset();
    mockAuthenticate.mockReset();
    mockEnforceRateLimit.mockReset();
    mockAuthenticate.mockResolvedValue({ accountId: 'acct-1', plan: 'starter' });
    mockEnforceRateLimit.mockResolvedValue(defaultRlInfo);
  });

  // --- auth + rate limit ---

  it('authenticates via normalized headers', async () => {
    mockGetBest.mockResolvedValueOnce({});
    await postQuote(makeEvent(validInput, { 'X-API-KEY': 'key-1' }));
    expect(mockAuthenticate).toHaveBeenCalledWith(
      expect.objectContaining({ 'x-api-key': 'key-1' }),
    );
  });

  it('enforces rate limit with accountId and plan', async () => {
    mockGetBest.mockResolvedValueOnce({});
    await postQuote(makeEvent(validInput));
    expect(mockEnforceRateLimit).toHaveBeenCalledWith('acct-1', 'starter');
  });

  it('returns rate-limit headers on success', async () => {
    mockGetBest.mockResolvedValueOnce({});
    const res = await postQuote(makeEvent(validInput));
    expect(res.headers['ratelimit-limit']).toBe('100');
    expect(res.headers['ratelimit-remaining']).toBe('99');
    expect(res.headers['ratelimit-reset']).toBe('1');
  });

  it('propagates UnauthorizedError from authenticate', async () => {
    mockAuthenticate.mockRejectedValueOnce(new Error('missing api key'));
    await expect(postQuote(makeEvent(validInput))).rejects.toThrow('missing api key');
    expect(mockEnforceRateLimit).not.toHaveBeenCalled();
    expect(mockGetBest).not.toHaveBeenCalled();
  });

  it('propagates TooManyRequestsError from enforceRateLimit', async () => {
    mockEnforceRateLimit.mockRejectedValueOnce(new Error('rate limit exceeded'));
    await expect(postQuote(makeEvent(validInput))).rejects.toThrow('rate limit exceeded');
    expect(mockGetBest).not.toHaveBeenCalled();
  });

  it('normalizes null headers without crashing', async () => {
    mockGetBest.mockResolvedValueOnce({});
    const res = await postQuote({ body: JSON.stringify(validInput), headers: null });
    expect(res.statusCode).toBe(200);
  });

  it('normalizes undefined headers without crashing', async () => {
    mockGetBest.mockResolvedValueOnce({});
    const res = await postQuote({ body: JSON.stringify(validInput), headers: undefined });
    expect(res.statusCode).toBe(200);
  });

  it('normalizes headers with null values to undefined', async () => {
    mockGetBest.mockResolvedValueOnce({});
    const res = await postQuote({
      body: JSON.stringify(validInput),
      headers: { 'x-api-key': 'k', 'x-custom': null },
    });
    expect(res.statusCode).toBe(200);
  });

  it('calls authenticate before rate limit', async () => {
    const order = [];
    mockAuthenticate.mockImplementation(async () => {
      order.push('auth');
      return { accountId: 'a', plan: 'free' };
    });
    mockEnforceRateLimit.mockImplementation(async () => {
      order.push('rl');
      return defaultRlInfo;
    });
    mockGetBest.mockResolvedValueOnce({});
    await postQuote(makeEvent(validInput));
    expect(order).toEqual(['auth', 'rl']);
  });

  // --- existing behavior ---

  it('returns 200 with quote on success', async () => {
    const fakeQuote = { exchange: 'moonpay', price: '0.9998', amount: '99.98' };
    mockGetBest.mockResolvedValueOnce(fakeQuote);

    const res = await postQuote(makeEvent(validInput));

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ quote: fakeQuote });
    expect(res.headers['content-type']).toBe('application/json');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('delegates parsed input to quoteService.getBest', async () => {
    mockGetBest.mockResolvedValueOnce({});
    await postQuote(makeEvent(validInput));

    expect(mockGetBest).toHaveBeenCalledWith(validInput);
  });

  it('passes optional exchange field to service', async () => {
    const input = { ...validInput, exchange: 'coinbase' };
    mockGetBest.mockResolvedValueOnce({});
    await postQuote(makeEvent(input));

    expect(mockGetBest).toHaveBeenCalledWith(input);
  });

  it('throws ValidationError for missing body', async () => {
    await expect(postQuote({ body: null, headers: { 'x-api-key': 'k' } })).rejects.toThrow(
      'Invalid request',
    );
  });

  it('throws ValidationError for non-JSON body', async () => {
    await expect(postQuote(makeEvent('not json'))).rejects.toThrow('Invalid request');
  });

  it('throws ValidationError for missing required fields', async () => {
    await expect(postQuote(makeEvent({ fiatCurrency: 'USD' }))).rejects.toThrow('Invalid request');
  });

  it('throws ValidationError for invalid fiatCurrency', async () => {
    await expect(postQuote(makeEvent({ ...validInput, fiatCurrency: 'JPY' }))).rejects.toThrow(
      'Invalid request',
    );
  });

  it('throws ValidationError for negative fiatAmount', async () => {
    await expect(postQuote(makeEvent({ ...validInput, fiatAmount: -10 }))).rejects.toThrow(
      'Invalid request',
    );
  });

  it('throws ValidationError for fiatAmount exceeding max', async () => {
    await expect(postQuote(makeEvent({ ...validInput, fiatAmount: 99999 }))).rejects.toThrow(
      'Invalid request',
    );
  });

  it('throws ValidationError for invalid cryptoAsset', async () => {
    await expect(postQuote(makeEvent({ ...validInput, cryptoAsset: 'BTC' }))).rejects.toThrow(
      'Invalid request',
    );
  });

  it('rejects empty string exchange name', async () => {
    await expect(postQuote(makeEvent({ ...validInput, exchange: '' }))).rejects.toThrow(
      'Invalid request',
    );
  });

  it('propagates service errors', async () => {
    mockGetBest.mockRejectedValueOnce(new Error('upstream down'));
    await expect(postQuote(makeEvent(validInput))).rejects.toThrow('upstream down');
  });

  it('strips extra fields via Zod schema', async () => {
    const input = { ...validInput, extraField: 'ignored' };
    mockGetBest.mockResolvedValueOnce({});
    await postQuote(makeEvent(input));

    const callArg = mockGetBest.mock.calls[0][0];
    expect(callArg).not.toHaveProperty('extraField');
  });

  it('accepts all valid fiatCurrency values', async () => {
    for (const cur of ['USD', 'EUR', 'GBP']) {
      mockGetBest.mockResolvedValueOnce({});
      const res = await postQuote(makeEvent({ ...validInput, fiatCurrency: cur }));
      expect(res.statusCode).toBe(200);
    }
  });

  it('accepts all valid cryptoAsset values', async () => {
    for (const asset of ['USDC', 'XRP', 'ETH']) {
      mockGetBest.mockResolvedValueOnce({});
      const res = await postQuote(makeEvent({ ...validInput, cryptoAsset: asset }));
      expect(res.statusCode).toBe(200);
    }
  });

  it('accepts any non-empty exchange string', async () => {
    mockGetBest.mockResolvedValueOnce({});
    const res = await postQuote(makeEvent({ ...validInput, exchange: 'some-adapter' }));
    expect(res.statusCode).toBe(200);
  });

  it('works without exchange field (optional)', async () => {
    const { fiatCurrency, fiatAmount, cryptoAsset } = validInput;
    mockGetBest.mockResolvedValueOnce({});
    const res = await postQuote(makeEvent({ fiatCurrency, fiatAmount, cryptoAsset }));
    expect(res.statusCode).toBe(200);
  });

  it('validates fiatAmount is a number, not a string', async () => {
    await expect(postQuote(makeEvent({ ...validInput, fiatAmount: '100' }))).rejects.toThrow(
      'Invalid request',
    );
  });

  it('throws ValidationError for zero fiatAmount', async () => {
    await expect(postQuote(makeEvent({ ...validInput, fiatAmount: 0 }))).rejects.toThrow(
      'Invalid request',
    );
  });

  it('accepts boundary fiatAmount of 50000', async () => {
    mockGetBest.mockResolvedValueOnce({});
    const res = await postQuote(makeEvent({ ...validInput, fiatAmount: 50000 }));
    expect(res.statusCode).toBe(200);
  });

  it('accepts small positive fiatAmount', async () => {
    mockGetBest.mockResolvedValueOnce({});
    const res = await postQuote(makeEvent({ ...validInput, fiatAmount: 0.01 }));
    expect(res.statusCode).toBe(200);
  });

  it('uses free plan limits for unknown plan', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: 'a', plan: 'unknown_tier' });
    mockGetBest.mockResolvedValueOnce({});
    await postQuote(makeEvent(validInput));
    expect(mockEnforceRateLimit).toHaveBeenCalledWith('a', 'unknown_tier');
  });
});

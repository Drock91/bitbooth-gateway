import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaymentRequiredError, ValidationError, UpstreamError } from '../../src/lib/errors.js';

const mockMatchRoute = vi.fn();

vi.mock('../../src/routes/index.js', () => ({
  matchRoute: (...args) => mockMatchRoute(...args),
}));
vi.mock('../../src/lib/logger.js', () => ({
  withCorrelation: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  flushLogger: vi.fn().mockResolvedValue(undefined),
}));

import { handler } from '../../src/handlers/api.handler.js';

function makeEvent(method = 'GET', path = '/v1/health', headers = {}) {
  return { httpMethod: method, path, headers };
}

describe('api.handler', () => {
  beforeEach(() => {
    mockMatchRoute.mockReset();
  });

  // --- 404 ---

  it('returns 404 when no route matches', async () => {
    mockMatchRoute.mockReturnValue(undefined);
    const res = await handler(makeEvent('GET', '/nope'));
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns JSON content-type on 404', async () => {
    mockMatchRoute.mockReturnValue(undefined);
    const res = await handler(makeEvent('GET', '/missing'));
    expect(res.headers['content-type']).toBe('application/json');
  });

  // --- successful route ---

  it('returns matched route response on success', async () => {
    const routeRes = {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"ok":true}',
    };
    mockMatchRoute.mockReturnValue(vi.fn().mockResolvedValue(routeRes));
    const res = await handler(makeEvent('POST', '/v1/quote'));
    expect(res).toEqual(routeRes);
  });

  it('passes the full event to the matched route handler', async () => {
    const routeFn = vi.fn().mockResolvedValue({ statusCode: 200, body: '' });
    mockMatchRoute.mockReturnValue(routeFn);
    const event = makeEvent('POST', '/v1/resource', { 'x-payment': 'sig' });
    await handler(event);
    expect(routeFn).toHaveBeenCalledWith(event);
  });

  // --- 402 PaymentRequired ---

  it('returns 402 with www-authenticate header for PaymentRequiredError', async () => {
    const challenge = { contract: '0xabc', amountWei: '1000' };
    mockMatchRoute.mockReturnValue(vi.fn().mockRejectedValue(new PaymentRequiredError(challenge)));
    const res = await handler(makeEvent('POST', '/v1/resource'));
    expect(res.statusCode).toBe(402);
    expect(res.headers['www-authenticate']).toBe('X402');
  });

  it('includes challenge details in 402 body', async () => {
    const challenge = { contract: '0xabc', amountWei: '1000' };
    mockMatchRoute.mockReturnValue(vi.fn().mockRejectedValue(new PaymentRequiredError(challenge)));
    const res = await handler(makeEvent('POST', '/v1/resource'));
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('PAYMENT_REQUIRED');
    expect(body.challenge).toEqual(challenge);
  });

  it('includes correlationId in 402 body', async () => {
    mockMatchRoute.mockReturnValue(vi.fn().mockRejectedValue(new PaymentRequiredError({})));
    const res = await handler(makeEvent('POST', '/v1/resource', { 'x-correlation-id': 'corr-42' }));
    const body = JSON.parse(res.body);
    expect(body.correlationId).toBe('corr-42');
  });

  // --- other AppErrors ---

  it('maps ValidationError to 400', async () => {
    mockMatchRoute.mockReturnValue(
      vi.fn().mockRejectedValue(new ValidationError([{ message: 'bad' }])),
    );
    const res = await handler(makeEvent('POST', '/v1/quote'));
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('maps UpstreamError to 502', async () => {
    mockMatchRoute.mockReturnValue(
      vi.fn().mockRejectedValue(new UpstreamError('moonpay', { reason: 'timeout' })),
    );
    const res = await handler(makeEvent('POST', '/v1/quote'));
    expect(res.statusCode).toBe(502);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('UPSTREAM_ERROR');
  });

  // --- unhandled / unknown errors → 500 ---

  it('returns 500 for unknown (non-AppError) exceptions', async () => {
    mockMatchRoute.mockReturnValue(
      vi.fn().mockRejectedValue(new TypeError('cannot read property')),
    );
    const res = await handler(makeEvent('GET', '/v1/health'));
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('includes correlationId in 500 body', async () => {
    mockMatchRoute.mockReturnValue(vi.fn().mockRejectedValue(new Error('boom')));
    const res = await handler(makeEvent('GET', '/v1/health', { 'x-correlation-id': 'corr-99' }));
    const body = JSON.parse(res.body);
    expect(body.correlationId).toBe('corr-99');
  });

  // --- correlation ID ---

  it('uses x-correlation-id from request header when present', async () => {
    mockMatchRoute.mockReturnValue(vi.fn().mockRejectedValue(new ValidationError([])));
    const res = await handler(makeEvent('POST', '/v1/quote', { 'x-correlation-id': 'custom-id' }));
    const body = JSON.parse(res.body);
    expect(body.correlationId).toBe('custom-id');
  });

  it('generates a UUID correlationId when header is missing', async () => {
    mockMatchRoute.mockReturnValue(vi.fn().mockRejectedValue(new ValidationError([])));
    const res = await handler(makeEvent('POST', '/v1/quote'));
    const body = JSON.parse(res.body);
    expect(body.correlationId).toMatch(/^[0-9a-f]{8}-/);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaymentRequiredError, ValidationError, UpstreamError } from '../../src/lib/errors.js';

const mockPostFetch = vi.fn();

vi.mock('../../src/controllers/fetch.controller.js', () => ({
  postFetch: (...args) => mockPostFetch(...args),
}));
vi.mock('../../src/lib/logger.js', () => ({
  withCorrelation: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  flushLogger: vi.fn().mockResolvedValue(undefined),
}));

import { handler } from '../../src/handlers/fetch.handler.js';

function makeEvent(method = 'POST', path = '/v1/fetch', headers = {}, body = null) {
  return { httpMethod: method, path, headers, body };
}

describe('fetch.handler', () => {
  beforeEach(() => {
    mockPostFetch.mockReset();
  });

  // --- 404 for wrong method/path ---

  it('returns 404 for GET /v1/fetch', async () => {
    const res = await handler(makeEvent('GET', '/v1/fetch'));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe('NOT_FOUND');
  });

  it('returns 404 for POST /v1/other', async () => {
    const res = await handler(makeEvent('POST', '/v1/other'));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe('NOT_FOUND');
  });

  it('returns JSON content-type on 404', async () => {
    const res = await handler(makeEvent('PUT', '/v1/fetch'));
    expect(res.headers['content-type']).toBe('application/json');
  });

  it('does not call postFetch for wrong path', async () => {
    await handler(makeEvent('POST', '/nope'));
    expect(mockPostFetch).not.toHaveBeenCalled();
  });

  // --- successful fetch ---

  it('returns controller response on success', async () => {
    const fetchRes = {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"title":"Test","markdown":"# Hi"}',
    };
    mockPostFetch.mockResolvedValue(fetchRes);
    const res = await handler(makeEvent());
    expect(res).toEqual(fetchRes);
  });

  it('passes the full event to postFetch', async () => {
    mockPostFetch.mockResolvedValue({ statusCode: 200, body: '{}' });
    const event = makeEvent(
      'POST',
      '/v1/fetch',
      { 'x-api-key': 'key123' },
      '{"url":"https://example.com"}',
    );
    await handler(event);
    expect(mockPostFetch).toHaveBeenCalledWith(event);
  });

  // --- 402 PaymentRequired ---

  it('returns 402 with www-authenticate header for PaymentRequiredError', async () => {
    const challenge = { contract: '0xabc', amountWei: '5000' };
    mockPostFetch.mockRejectedValue(new PaymentRequiredError(challenge));
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(402);
    expect(res.headers['www-authenticate']).toBe('X402');
  });

  it('includes challenge details in 402 body', async () => {
    const challenge = { contract: '0xabc', amountWei: '5000' };
    mockPostFetch.mockRejectedValue(new PaymentRequiredError(challenge));
    const res = await handler(makeEvent());
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('PAYMENT_REQUIRED');
    expect(body.challenge).toEqual(challenge);
  });

  it('includes correlationId in 402 body', async () => {
    mockPostFetch.mockRejectedValue(new PaymentRequiredError({}));
    const res = await handler(
      makeEvent('POST', '/v1/fetch', { 'x-correlation-id': 'corr-fetch-1' }),
    );
    const body = JSON.parse(res.body);
    expect(body.correlationId).toBe('corr-fetch-1');
  });

  // --- other AppErrors ---

  it('maps ValidationError to 400', async () => {
    mockPostFetch.mockRejectedValue(new ValidationError([{ message: 'bad url' }]));
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('maps UpstreamError to 502', async () => {
    mockPostFetch.mockRejectedValue(new UpstreamError('fetch-target', { reason: 'timeout' }));
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error.code).toBe('UPSTREAM_ERROR');
  });

  // --- unhandled errors → 500 ---

  it('returns 500 for unknown exceptions', async () => {
    mockPostFetch.mockRejectedValue(new TypeError('cannot read property'));
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error.code).toBe('INTERNAL_ERROR');
  });

  it('includes correlationId in 500 body', async () => {
    mockPostFetch.mockRejectedValue(new Error('boom'));
    const res = await handler(makeEvent('POST', '/v1/fetch', { 'x-correlation-id': 'corr-500' }));
    const body = JSON.parse(res.body);
    expect(body.correlationId).toBe('corr-500');
  });

  // --- correlationId ---

  it('uses x-correlation-id from request header', async () => {
    mockPostFetch.mockRejectedValue(new ValidationError([]));
    const res = await handler(makeEvent('POST', '/v1/fetch', { 'x-correlation-id': 'custom-id' }));
    const body = JSON.parse(res.body);
    expect(body.correlationId).toBe('custom-id');
  });

  it('generates a UUID correlationId when header is missing', async () => {
    mockPostFetch.mockRejectedValue(new ValidationError([]));
    const res = await handler(makeEvent());
    const body = JSON.parse(res.body);
    expect(body.correlationId).toMatch(/^[0-9a-f]{8}-/);
  });

  // --- security headers ---

  it('includes security headers on success', async () => {
    mockPostFetch.mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' });
    const res = await handler(makeEvent());
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('includes security headers on error', async () => {
    mockPostFetch.mockRejectedValue(new Error('fail'));
    const res = await handler(makeEvent());
    expect(res.headers['x-frame-options']).toBe('DENY');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuthenticate,
  mockGetRouteConfig,
  mockRequirePayment,
  mockEnforceRateLimit,
  mockListPayments,
} = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  mockGetRouteConfig: vi.fn(),
  mockRequirePayment: vi.fn(),
  mockEnforceRateLimit: vi.fn(),
  mockListPayments: vi.fn(),
}));

vi.mock('../../src/middleware/auth.middleware.js', () => ({
  authenticate: mockAuthenticate,
}));
vi.mock('../../src/middleware/rate-limit.middleware.js', () => ({
  enforceRateLimit: mockEnforceRateLimit,
  rateLimitHeaders: (info) => ({
    'ratelimit-limit': String(info.limit),
    'ratelimit-remaining': String(info.remaining),
    'ratelimit-reset': String(info.reset),
  }),
}));
vi.mock('../../src/middleware/idempotency.middleware.js', () => ({
  withIdempotency: (_headers, handler) => handler(),
}));
vi.mock('../../src/services/routes.service.js', () => ({
  routesService: { getRouteConfig: mockGetRouteConfig },
}));
vi.mock('../../src/services/payments.service.js', () => ({
  paymentsService: { requirePayment: mockRequirePayment, listPayments: mockListPayments },
}));
vi.mock('../../src/middleware/error.middleware.js', () => ({
  jsonResponse: (status, body) => ({
    statusCode: status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }),
}));

import {
  requirePaidResource,
  requireBulkResource,
  getPayments,
} from '../../src/controllers/payments.controller.js';

const ACCOUNT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const TX_HASH = '0xabc123';

function makeEvent(path = '/v1/resource') {
  return {
    path,
    headers: { 'x-api-key': 'test-key', 'x-payment': '{}' },
  };
}

describe('payments.controller — requirePaidResource', () => {
  beforeEach(() => {
    mockAuthenticate.mockReset();
    mockEnforceRateLimit.mockReset();
    mockGetRouteConfig.mockReset();
    mockRequirePayment.mockReset();
    mockEnforceRateLimit.mockResolvedValue({ limit: 10, remaining: 9, reset: 6 });
  });

  it('looks up route config by accountId and path', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    mockGetRouteConfig.mockResolvedValueOnce({
      resource: '/v1/resource',
      amountWei: '5000000',
      assetSymbol: 'USDC',
    });
    mockRequirePayment.mockResolvedValueOnce({ txHash: TX_HASH });

    await requirePaidResource(makeEvent());

    expect(mockGetRouteConfig).toHaveBeenCalledWith(ACCOUNT_ID, '/v1/resource');
  });

  it('passes route config to paymentsService.requirePayment', async () => {
    const routeConfig = { resource: '/v1/resource', amountWei: '5000000', assetSymbol: 'USDC' };
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    mockGetRouteConfig.mockResolvedValueOnce(routeConfig);
    mockRequirePayment.mockResolvedValueOnce({ txHash: TX_HASH });

    await requirePaidResource(makeEvent());

    expect(mockRequirePayment).toHaveBeenCalledWith(
      expect.objectContaining({ route: routeConfig, accountId: ACCOUNT_ID }),
    );
  });

  it('returns 200 with txHash on success', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    mockGetRouteConfig.mockResolvedValueOnce({
      resource: '/v1/resource',
      amountWei: '5000000',
      assetSymbol: 'USDC',
    });
    mockRequirePayment.mockResolvedValueOnce({ txHash: TX_HASH });

    const res = await requirePaidResource(makeEvent());
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.txHash).toBe(TX_HASH);
    expect(body.resource).toBe('/v1/resource');
  });

  it('looks up route config by premium path when event.path is /v1/resource/premium', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    mockGetRouteConfig.mockResolvedValueOnce({
      resource: '/v1/resource/premium',
      amountWei: '10000000',
      assetSymbol: 'USDC',
    });
    mockRequirePayment.mockResolvedValueOnce({ txHash: TX_HASH });

    const res = await requirePaidResource(makeEvent('/v1/resource/premium'));
    const body = JSON.parse(res.body);

    expect(mockGetRouteConfig).toHaveBeenCalledWith(ACCOUNT_ID, '/v1/resource/premium');
    expect(body.resource).toBe('/v1/resource/premium');
  });

  it('propagates auth errors', async () => {
    mockAuthenticate.mockRejectedValueOnce(new Error('missing api key'));
    await expect(requirePaidResource(makeEvent())).rejects.toThrow('missing api key');
  });

  it('propagates route-not-found errors', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    mockGetRouteConfig.mockRejectedValueOnce(new Error('Route not found'));
    await expect(requirePaidResource(makeEvent())).rejects.toThrow('Route not found');
  });

  it('normalizes headers to lowercase', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    mockGetRouteConfig.mockResolvedValueOnce({
      resource: '/v1/resource',
      amountWei: '5000000',
      assetSymbol: 'USDC',
    });
    mockRequirePayment.mockResolvedValueOnce({ txHash: TX_HASH });

    const event = { path: '/v1/resource', headers: { 'X-Api-Key': 'k', 'X-Payment': '{}' } };
    await requirePaidResource(event);

    const passedHeaders = mockAuthenticate.mock.calls[0][0];
    expect(passedHeaders['x-api-key']).toBe('k');
  });

  it('normalizes null header values to undefined', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    mockGetRouteConfig.mockResolvedValueOnce({
      resource: '/v1/resource',
      amountWei: '5000000',
      assetSymbol: 'USDC',
    });
    mockRequirePayment.mockResolvedValueOnce({ txHash: TX_HASH });

    const event = { path: '/v1/resource', headers: { 'x-api-key': 'k', 'x-null': null } };
    await requirePaidResource(event);

    const passedHeaders = mockAuthenticate.mock.calls[0][0];
    expect(passedHeaders['x-null']).toBeUndefined();
    expect(passedHeaders['x-api-key']).toBe('k');
  });

  it('handles null headers object', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    mockGetRouteConfig.mockResolvedValueOnce({
      resource: '/v1/resource',
      amountWei: '5000000',
      assetSymbol: 'USDC',
    });
    mockRequirePayment.mockResolvedValueOnce({ txHash: TX_HASH });

    const event = { path: '/v1/resource', headers: null };
    await requirePaidResource(event);

    const passedHeaders = mockAuthenticate.mock.calls[0][0];
    expect(passedHeaders).toEqual({});
  });

  it('handles undefined headers object', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    mockGetRouteConfig.mockResolvedValueOnce({
      resource: '/v1/resource',
      amountWei: '5000000',
      assetSymbol: 'USDC',
    });
    mockRequirePayment.mockResolvedValueOnce({ txHash: TX_HASH });

    const event = { path: '/v1/resource' };
    await requirePaidResource(event);

    const passedHeaders = mockAuthenticate.mock.calls[0][0];
    expect(passedHeaders).toEqual({});
  });

  it('includes RateLimit-* headers on success', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'growth' });
    mockEnforceRateLimit.mockResolvedValueOnce({ limit: 500, remaining: 499, reset: 1 });
    mockGetRouteConfig.mockResolvedValueOnce({
      resource: '/v1/resource',
      amountWei: '5000000',
      assetSymbol: 'USDC',
    });
    mockRequirePayment.mockResolvedValueOnce({ txHash: TX_HASH });

    const res = await requirePaidResource(makeEvent());
    expect(res.headers['ratelimit-limit']).toBe('500');
    expect(res.headers['ratelimit-remaining']).toBe('499');
    expect(res.headers['ratelimit-reset']).toBe('1');
  });

  it('enforces rate limit before route lookup', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'starter' });
    mockEnforceRateLimit.mockRejectedValueOnce(new Error('rate limit exceeded'));

    await expect(requirePaidResource(makeEvent())).rejects.toThrow('rate limit exceeded');
    expect(mockEnforceRateLimit).toHaveBeenCalledWith(ACCOUNT_ID, 'starter');
    expect(mockGetRouteConfig).not.toHaveBeenCalled();
  });
});

describe('payments.controller — getPayments', () => {
  beforeEach(() => {
    mockAuthenticate.mockReset();
    mockEnforceRateLimit.mockReset();
    mockListPayments.mockReset();
    mockEnforceRateLimit.mockResolvedValue({ limit: 10, remaining: 9, reset: 6 });
  });

  function makeGetEvent(qs = {}) {
    return {
      headers: { 'x-api-key': 'test-key' },
      queryStringParameters: qs,
    };
  }

  it('returns 200 with payments and nextCursor', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    mockListPayments.mockResolvedValueOnce({
      payments: [{ idempotencyKey: 'n1' }],
      nextCursor: 'abc123',
    });

    const res = await getPayments(makeGetEvent());
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.payments).toEqual([{ idempotencyKey: 'n1' }]);
    expect(body.nextCursor).toBe('abc123');
  });

  it('passes limit and cursor to service', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    mockListPayments.mockResolvedValueOnce({ payments: [], nextCursor: null });

    await getPayments(makeGetEvent({ limit: '50', cursor: 'xyz' }));

    expect(mockListPayments).toHaveBeenCalledWith(ACCOUNT_ID, { limit: 50, cursor: 'xyz' });
  });

  it('uses default limit when not specified', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    mockListPayments.mockResolvedValueOnce({ payments: [], nextCursor: null });

    await getPayments(makeGetEvent());

    expect(mockListPayments).toHaveBeenCalledWith(ACCOUNT_ID, { limit: 20, cursor: undefined });
  });

  it('throws ValidationError for invalid limit', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });

    await expect(getPayments(makeGetEvent({ limit: '0' }))).rejects.toThrow();
  });

  it('throws ValidationError for limit > 100', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });

    await expect(getPayments(makeGetEvent({ limit: '101' }))).rejects.toThrow();
  });

  it('throws ValidationError for non-numeric limit', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });

    await expect(getPayments(makeGetEvent({ limit: 'abc' }))).rejects.toThrow();
  });

  it('propagates auth errors', async () => {
    mockAuthenticate.mockRejectedValueOnce(new Error('unauthorized'));

    await expect(getPayments(makeGetEvent())).rejects.toThrow('unauthorized');
  });

  it('propagates service errors', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    mockListPayments.mockRejectedValueOnce(new Error('DDB error'));

    await expect(getPayments(makeGetEvent())).rejects.toThrow('DDB error');
  });

  it('handles null queryStringParameters', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    mockListPayments.mockResolvedValueOnce({ payments: [], nextCursor: null });

    const event = { headers: { 'x-api-key': 'k' }, queryStringParameters: null };
    const res = await getPayments(event);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.payments).toEqual([]);
  });

  it('returns null nextCursor when no more pages', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    mockListPayments.mockResolvedValueOnce({
      payments: [{ idempotencyKey: 'n1' }],
      nextCursor: null,
    });

    const res = await getPayments(makeGetEvent());
    const body = JSON.parse(res.body);

    expect(body.nextCursor).toBeNull();
  });

  it('normalizes headers to lowercase before auth', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    mockListPayments.mockResolvedValueOnce({ payments: [], nextCursor: null });

    const event = { headers: { 'X-Api-Key': 'k' }, queryStringParameters: {} };
    await getPayments(event);

    const passedHeaders = mockAuthenticate.mock.calls[0][0];
    expect(passedHeaders['x-api-key']).toBe('k');
  });

  it('enforces rate limit with accountId and plan', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'growth' });
    mockListPayments.mockResolvedValueOnce({ payments: [], nextCursor: null });

    await getPayments(makeGetEvent());

    expect(mockEnforceRateLimit).toHaveBeenCalledWith(ACCOUNT_ID, 'growth');
  });

  it('includes RateLimit-* headers on success', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'starter' });
    mockEnforceRateLimit.mockResolvedValueOnce({ limit: 100, remaining: 99, reset: 1 });
    mockListPayments.mockResolvedValueOnce({ payments: [], nextCursor: null });

    const res = await getPayments(makeGetEvent());
    expect(res.headers['ratelimit-limit']).toBe('100');
    expect(res.headers['ratelimit-remaining']).toBe('99');
    expect(res.headers['ratelimit-reset']).toBe('1');
  });

  it('rejects with 429 when rate limit exhausted', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    mockEnforceRateLimit.mockRejectedValueOnce(new Error('rate limit exceeded'));

    await expect(getPayments(makeGetEvent())).rejects.toThrow('rate limit exceeded');
    expect(mockListPayments).not.toHaveBeenCalled();
  });

  it('enforces rate limit before query validation', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    mockEnforceRateLimit.mockRejectedValueOnce(new Error('rate limit exceeded'));

    await expect(getPayments(makeGetEvent({ limit: 'invalid' }))).rejects.toThrow(
      'rate limit exceeded',
    );
  });

  it('passes plan from authenticate to enforceRateLimit', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'scale' });
    mockListPayments.mockResolvedValueOnce({ payments: [], nextCursor: null });

    await getPayments(makeGetEvent());

    expect(mockEnforceRateLimit).toHaveBeenCalledWith(ACCOUNT_ID, 'scale');
  });

  it('does not call enforceRateLimit when auth fails', async () => {
    mockAuthenticate.mockRejectedValueOnce(new Error('unauthorized'));

    await expect(getPayments(makeGetEvent())).rejects.toThrow('unauthorized');
    expect(mockEnforceRateLimit).not.toHaveBeenCalled();
  });

  it('includes rate limit headers with paginated results', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'growth' });
    mockEnforceRateLimit.mockResolvedValueOnce({ limit: 500, remaining: 450, reset: 1 });
    mockListPayments.mockResolvedValueOnce({
      payments: [{ idempotencyKey: 'n1' }],
      nextCursor: 'page2',
    });

    const res = await getPayments(makeGetEvent({ limit: '10', cursor: 'page1' }));
    const body = JSON.parse(res.body);

    expect(res.headers['ratelimit-limit']).toBe('500');
    expect(body.nextCursor).toBe('page2');
  });
});

describe('payments.controller — requireBulkResource', () => {
  beforeEach(() => {
    mockAuthenticate.mockReset();
    mockEnforceRateLimit.mockReset();
    mockGetRouteConfig.mockReset();
    mockRequirePayment.mockReset();
    mockEnforceRateLimit.mockResolvedValue({ limit: 10, remaining: 9, reset: 6 });
  });

  function makeBulkEvent(items = [{ id: 'a' }, { id: 'b' }]) {
    return {
      path: '/v1/resource/bulk',
      headers: { 'x-api-key': 'test-key' },
      body: JSON.stringify({ items }),
    };
  }

  it('returns 200 with items and totalItems on success', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    mockGetRouteConfig.mockResolvedValueOnce({
      resource: '/v1/resource/bulk',
      amountWei: '5000',
      assetSymbol: 'USDC',
    });
    mockRequirePayment.mockResolvedValueOnce({ txHash: TX_HASH });

    const res = await requireBulkResource(makeBulkEvent());
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.txHash).toBe(TX_HASH);
    expect(body.resource).toBe('/v1/resource/bulk');
    expect(body.totalItems).toBe(2);
    expect(body.items).toEqual([
      { id: 'a', status: 'completed' },
      { id: 'b', status: 'completed' },
    ]);
  });

  it('multiplies unit price by item count for x402 payment', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    mockGetRouteConfig.mockResolvedValueOnce({
      resource: '/v1/resource/bulk',
      amountWei: '5000',
      assetSymbol: 'USDC',
    });
    mockRequirePayment.mockResolvedValueOnce({ txHash: TX_HASH });

    const items = Array.from({ length: 3 }, (_, i) => ({ id: `item-${i}` }));
    await requireBulkResource(makeBulkEvent(items));

    const call = mockRequirePayment.mock.calls[0][0];
    expect(call.route.amountWei).toBe('15000'); // 5000 * 3
  });

  it('handles large wei amounts without precision loss', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    mockGetRouteConfig.mockResolvedValueOnce({
      resource: '/v1/resource/bulk',
      amountWei: '999999999999999999',
      assetSymbol: 'USDC',
    });
    mockRequirePayment.mockResolvedValueOnce({ txHash: TX_HASH });

    const items = Array.from({ length: 10 }, (_, i) => ({ id: `item-${i}` }));
    await requireBulkResource(makeBulkEvent(items));

    const call = mockRequirePayment.mock.calls[0][0];
    expect(call.route.amountWei).toBe('9999999999999999990');
  });

  it('preserves original route fields in bulkRoute', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    mockGetRouteConfig.mockResolvedValueOnce({
      resource: '/v1/resource/bulk',
      amountWei: '1000',
      assetSymbol: 'USDC',
    });
    mockRequirePayment.mockResolvedValueOnce({ txHash: TX_HASH });

    await requireBulkResource(makeBulkEvent([{ id: 'x' }]));

    const call = mockRequirePayment.mock.calls[0][0];
    expect(call.route.assetSymbol).toBe('USDC');
    expect(call.route.resource).toBe('/v1/resource/bulk');
    expect(call.route.amountWei).toBe('1000'); // 1000 * 1
  });

  it('throws ValidationError for empty items array', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    mockEnforceRateLimit.mockResolvedValueOnce({ limit: 10, remaining: 9, reset: 6 });

    await expect(requireBulkResource(makeBulkEvent([]))).rejects.toThrow();
  });

  it('throws ValidationError for >10 items', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    mockEnforceRateLimit.mockResolvedValueOnce({ limit: 10, remaining: 9, reset: 6 });

    const items = Array.from({ length: 11 }, (_, i) => ({ id: `i-${i}` }));
    await expect(requireBulkResource(makeBulkEvent(items))).rejects.toThrow();
  });

  it('throws ValidationError for malformed body', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    mockEnforceRateLimit.mockResolvedValueOnce({ limit: 10, remaining: 9, reset: 6 });

    const event = {
      path: '/v1/resource/bulk',
      headers: { 'x-api-key': 'test-key' },
      body: '{"wrong": true}',
    };
    await expect(requireBulkResource(event)).rejects.toThrow();
  });

  it('handles null body gracefully', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    mockEnforceRateLimit.mockResolvedValueOnce({ limit: 10, remaining: 9, reset: 6 });

    const event = {
      path: '/v1/resource/bulk',
      headers: { 'x-api-key': 'test-key' },
      body: null,
    };
    await expect(requireBulkResource(event)).rejects.toThrow();
  });

  it('propagates auth errors', async () => {
    mockAuthenticate.mockRejectedValueOnce(new Error('unauthorized'));
    await expect(requireBulkResource(makeBulkEvent())).rejects.toThrow('unauthorized');
  });

  it('propagates rate limit errors before body parsing', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    mockEnforceRateLimit.mockRejectedValueOnce(new Error('rate limit exceeded'));

    await expect(requireBulkResource(makeBulkEvent())).rejects.toThrow('rate limit exceeded');
    expect(mockGetRouteConfig).not.toHaveBeenCalled();
  });

  it('includes RateLimit-* headers on success', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'growth' });
    mockEnforceRateLimit.mockResolvedValueOnce({ limit: 500, remaining: 499, reset: 1 });
    mockGetRouteConfig.mockResolvedValueOnce({
      resource: '/v1/resource/bulk',
      amountWei: '1000',
      assetSymbol: 'USDC',
    });
    mockRequirePayment.mockResolvedValueOnce({ txHash: TX_HASH });

    const res = await requireBulkResource(makeBulkEvent());
    expect(res.headers['ratelimit-limit']).toBe('500');
    expect(res.headers['ratelimit-remaining']).toBe('499');
  });

  it('normalizes headers to lowercase', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    mockGetRouteConfig.mockResolvedValueOnce({
      resource: '/v1/resource/bulk',
      amountWei: '1000',
      assetSymbol: 'USDC',
    });
    mockRequirePayment.mockResolvedValueOnce({ txHash: TX_HASH });

    const event = {
      path: '/v1/resource/bulk',
      headers: { 'X-Api-Key': 'k' },
      body: JSON.stringify({ items: [{ id: 'a' }] }),
    };
    await requireBulkResource(event);

    const passedHeaders = mockAuthenticate.mock.calls[0][0];
    expect(passedHeaders['x-api-key']).toBe('k');
  });

  it('passes accountId to payment service', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    mockGetRouteConfig.mockResolvedValueOnce({
      resource: '/v1/resource/bulk',
      amountWei: '1000',
      assetSymbol: 'USDC',
    });
    mockRequirePayment.mockResolvedValueOnce({ txHash: TX_HASH });

    await requireBulkResource(makeBulkEvent());

    const call = mockRequirePayment.mock.calls[0][0];
    expect(call.accountId).toBe(ACCOUNT_ID);
  });

  it('single-item batch uses exact unit price', async () => {
    mockAuthenticate.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    mockGetRouteConfig.mockResolvedValueOnce({
      resource: '/v1/resource/bulk',
      amountWei: '7777',
      assetSymbol: 'USDC',
    });
    mockRequirePayment.mockResolvedValueOnce({ txHash: TX_HASH });

    await requireBulkResource(makeBulkEvent([{ id: 'only' }]));

    const call = mockRequirePayment.mock.calls[0][0];
    expect(call.route.amountWei).toBe('7777');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInfo = vi.fn();
const mockError = vi.fn();

vi.mock('../../src/lib/logger.js', () => ({
  withCorrelation: vi.fn(() => ({ info: mockInfo, error: mockError })),
}));

import { withRequestLogging } from '../../src/middleware/request-log.middleware.js';
import { withCorrelation } from '../../src/lib/logger.js';

function makeEvent(method = 'GET', path = '/v1/health', headers = {}) {
  return { httpMethod: method, path, headers };
}

describe('request-log.middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- structured logging ---

  it('logs method, path, status, and ms on success', async () => {
    const inner = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' });
    const wrapped = withRequestLogging(inner);

    await wrapped(makeEvent('POST', '/v1/quote'));

    expect(mockInfo).toHaveBeenCalledOnce();
    const [ctx, msg] = mockInfo.mock.calls[0];
    expect(ctx.method).toBe('POST');
    expect(ctx.path).toBe('/v1/quote');
    expect(ctx.status).toBe(200);
    expect(typeof ctx.ms).toBe('number');
    expect(msg).toBe('request');
  });

  it('logs error with method, path, ms when handler throws', async () => {
    const err = new Error('boom');
    const inner = vi.fn().mockRejectedValue(err);
    const wrapped = withRequestLogging(inner);

    await expect(wrapped(makeEvent('DELETE', '/v1/resource'))).rejects.toThrow('boom');

    expect(mockError).toHaveBeenCalledOnce();
    const [ctx, msg] = mockError.mock.calls[0];
    expect(ctx.method).toBe('DELETE');
    expect(ctx.path).toBe('/v1/resource');
    expect(typeof ctx.ms).toBe('number');
    expect(ctx.err).toBe(err);
    expect(msg).toBe('request error');
  });

  it('re-throws the original error after logging', async () => {
    const err = new TypeError('bad call');
    const inner = vi.fn().mockRejectedValue(err);
    const wrapped = withRequestLogging(inner);

    await expect(wrapped(makeEvent())).rejects.toBe(err);
  });

  // --- correlationId ---

  it('uses x-correlation-id from request headers', async () => {
    const inner = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' });
    const wrapped = withRequestLogging(inner);

    await wrapped(makeEvent('GET', '/', { 'x-correlation-id': 'corr-abc' }));

    expect(withCorrelation).toHaveBeenCalledWith('corr-abc');
  });

  it('generates a UUID when x-correlation-id header is absent', async () => {
    const inner = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' });
    const wrapped = withRequestLogging(inner);

    await wrapped(makeEvent('GET', '/'));

    const id = withCorrelation.mock.calls[0][0];
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('injects x-correlation-id into response headers', async () => {
    const inner = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: '',
    });
    const wrapped = withRequestLogging(inner);

    const res = await wrapped(makeEvent('GET', '/', { 'x-correlation-id': 'corr-xyz' }));

    expect(res.headers['x-correlation-id']).toBe('corr-xyz');
    expect(res.headers['content-type']).toBe('application/json');
  });

  // --- context passed to inner handler ---

  it('passes correlationId and log to the inner function', async () => {
    const inner = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' });
    const wrapped = withRequestLogging(inner);

    await wrapped(makeEvent('GET', '/', { 'x-correlation-id': 'corr-pass' }));

    const [, ctx] = inner.mock.calls[0];
    expect(ctx.correlationId).toBe('corr-pass');
    expect(ctx.log).toEqual({ info: expect.any(Function), error: expect.any(Function) });
  });

  it('passes the original event as first argument', async () => {
    const inner = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' });
    const wrapped = withRequestLogging(inner);
    const event = makeEvent('PUT', '/v1/thing', { 'x-api-key': 'abc' });

    await wrapped(event);

    expect(inner.mock.calls[0][0]).toBe(event);
  });

  // --- edge cases ---

  it('defaults method to UNKNOWN when httpMethod is absent', async () => {
    const inner = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' });
    const wrapped = withRequestLogging(inner);

    await wrapped({ path: '/test', headers: {} });

    const [ctx] = mockInfo.mock.calls[0];
    expect(ctx.method).toBe('UNKNOWN');
  });

  it('defaults path to / when path is absent', async () => {
    const inner = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' });
    const wrapped = withRequestLogging(inner);

    await wrapped({ httpMethod: 'GET', headers: {} });

    const [ctx] = mockInfo.mock.calls[0];
    expect(ctx.path).toBe('/');
  });

  it('defaults status to 0 when response has no statusCode', async () => {
    const inner = vi.fn().mockResolvedValue({ headers: {}, body: '' });
    const wrapped = withRequestLogging(inner);

    await wrapped(makeEvent());

    const [ctx] = mockInfo.mock.calls[0];
    expect(ctx.status).toBe(0);
  });

  it('handles undefined event.headers without crashing', async () => {
    const inner = vi.fn().mockResolvedValue({ statusCode: 204, headers: {}, body: '' });
    const wrapped = withRequestLogging(inner);

    const res = await wrapped({ httpMethod: 'OPTIONS', path: '/preflight' });

    expect(res.statusCode).toBe(204);
    const id = withCorrelation.mock.calls[0][0];
    expect(id).toMatch(/^[0-9a-f]{8}-/);
  });

  it('preserves existing response headers while adding correlation id', async () => {
    const inner = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: { 'cache-control': 'no-store', 'x-custom': 'foo' },
      body: '',
    });
    const wrapped = withRequestLogging(inner);

    const res = await wrapped(makeEvent('GET', '/', { 'x-correlation-id': 'c-1' }));

    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-custom']).toBe('foo');
    expect(res.headers['x-correlation-id']).toBe('c-1');
  });

  it('does not log info when handler throws', async () => {
    const inner = vi.fn().mockRejectedValue(new Error('fail'));
    const wrapped = withRequestLogging(inner);

    await expect(wrapped(makeEvent())).rejects.toThrow();

    expect(mockInfo).not.toHaveBeenCalled();
    expect(mockError).toHaveBeenCalledOnce();
  });

  it('measures positive latency', async () => {
    const inner = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return { statusCode: 200, headers: {}, body: '' };
    });
    const wrapped = withRequestLogging(inner);

    await wrapped(makeEvent());

    const [ctx] = mockInfo.mock.calls[0];
    expect(ctx.ms).toBeGreaterThanOrEqual(5);
  });
});

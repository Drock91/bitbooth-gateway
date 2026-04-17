import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFlush } = vi.hoisted(() => ({
  mockFlush: vi.fn(),
}));

vi.mock('../../src/lib/logger.js', () => ({
  flushLogger: mockFlush,
}));

import { withGracefulShutdown } from '../../src/middleware/shutdown.middleware.js';

describe('shutdown.middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFlush.mockResolvedValue(undefined);
  });

  it('returns the handler response', async () => {
    const inner = vi.fn().mockResolvedValue({ statusCode: 200, body: 'ok' });
    const wrapped = withGracefulShutdown(inner);

    const res = await wrapped({ httpMethod: 'GET' }, {});

    expect(res).toEqual({ statusCode: 200, body: 'ok' });
  });

  it('passes event and context to the inner handler', async () => {
    const inner = vi.fn().mockResolvedValue({ statusCode: 200 });
    const wrapped = withGracefulShutdown(inner);
    const event = { httpMethod: 'POST', path: '/test' };
    const context = { functionName: 'myFn' };

    await wrapped(event, context);

    expect(inner).toHaveBeenCalledWith(event, context);
  });

  it('calls flushLogger after the handler completes', async () => {
    const order = [];
    const inner = vi.fn().mockImplementation(async () => {
      order.push('handler');
      return { statusCode: 200 };
    });
    mockFlush.mockImplementation(async () => {
      order.push('flush');
    });
    const wrapped = withGracefulShutdown(inner);

    await wrapped({}, {});

    expect(order).toEqual(['handler', 'flush']);
  });

  it('calls flushLogger even when handler throws', async () => {
    const inner = vi.fn().mockRejectedValue(new Error('boom'));
    const wrapped = withGracefulShutdown(inner);

    await expect(wrapped({}, {})).rejects.toThrow('boom');

    expect(mockFlush).toHaveBeenCalledOnce();
  });

  it('re-throws the original error after flushing', async () => {
    const err = new TypeError('type fail');
    const inner = vi.fn().mockRejectedValue(err);
    const wrapped = withGracefulShutdown(inner);

    await expect(wrapped({}, {})).rejects.toBe(err);
  });

  it('does not swallow flush errors on success path', async () => {
    const inner = vi.fn().mockResolvedValue({ statusCode: 200 });
    mockFlush.mockRejectedValue(new Error('flush failed'));
    const wrapped = withGracefulShutdown(inner);

    await expect(wrapped({}, {})).rejects.toThrow('flush failed');
  });

  it('propagates handler error even if flush also fails', async () => {
    const handlerErr = new Error('handler boom');
    const inner = vi.fn().mockRejectedValue(handlerErr);
    mockFlush.mockRejectedValue(new Error('flush boom'));
    const wrapped = withGracefulShutdown(inner);

    await expect(wrapped({}, {})).rejects.toBe(handlerErr);
  });

  it('flushes exactly once per invocation', async () => {
    const inner = vi.fn().mockResolvedValue({ statusCode: 204 });
    const wrapped = withGracefulShutdown(inner);

    await wrapped({}, {});

    expect(mockFlush).toHaveBeenCalledOnce();
  });

  it('works with undefined context', async () => {
    const inner = vi.fn().mockResolvedValue({ statusCode: 200 });
    const wrapped = withGracefulShutdown(inner);

    const res = await wrapped({});

    expect(res.statusCode).toBe(200);
    expect(mockFlush).toHaveBeenCalledOnce();
  });
});

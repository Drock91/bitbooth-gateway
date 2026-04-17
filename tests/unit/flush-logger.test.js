import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockFlushCb } = vi.hoisted(() => ({
  mockFlushCb: vi.fn(),
}));

vi.mock('pino', () => {
  const instance = {
    level: 'info',
    child: vi.fn(() => instance),
    info: vi.fn(),
    error: vi.fn(),
    flush: mockFlushCb,
  };
  const pino = vi.fn(() => instance);
  pino.stdTimeFunctions = { isoTime: vi.fn() };
  return { default: pino };
});

import { flushLogger } from '../../src/lib/logger.js';

describe('flushLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves when pino flush callback fires', async () => {
    mockFlushCb.mockImplementation((cb) => cb(null));

    const result = await flushLogger();

    expect(result).toBeNull();
    expect(mockFlushCb).toHaveBeenCalledOnce();
  });

  it('resolves with error argument from flush callback', async () => {
    const err = new Error('flush err');
    mockFlushCb.mockImplementation((cb) => cb(err));

    const result = await flushLogger();

    expect(result).toBe(err);
  });

  it('resolves on timeout if flush callback never fires', async () => {
    mockFlushCb.mockImplementation(() => {});

    const p = flushLogger(100);
    vi.advanceTimersByTime(100);
    const result = await p;

    expect(result).toBeUndefined();
  });

  it('clears the timeout when flush callback fires before timeout', async () => {
    mockFlushCb.mockImplementation((cb) => cb(null));

    await flushLogger(5000);

    vi.advanceTimersByTime(5000);
  });

  it('uses default timeout of 2000ms', async () => {
    mockFlushCb.mockImplementation(() => {});

    const p = flushLogger();
    vi.advanceTimersByTime(2000);
    const result = await p;

    expect(result).toBeUndefined();
  });

  it('accepts custom timeout', async () => {
    mockFlushCb.mockImplementation(() => {});

    const p = flushLogger(50);
    vi.advanceTimersByTime(50);
    const result = await p;

    expect(result).toBeUndefined();
  });
});

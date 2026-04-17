import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSweepDlq } = vi.hoisted(() => ({ mockSweepDlq: vi.fn() }));

vi.mock('../../src/services/webhook-dlq.service.js', () => ({
  sweepDlq: mockSweepDlq,
}));

vi.mock('../../src/lib/logger.js', () => {
  const noop = () => {};
  const child = () => ({ info: noop, warn: noop, error: noop, child });
  return { logger: { child } };
});

import { handler } from '../../src/handlers/dlq-sweep.handler.js';

describe('dlq-sweep.handler', () => {
  beforeEach(() => {
    mockSweepDlq.mockReset();
  });

  it('calls sweepDlq and returns result', async () => {
    const expected = { processed: 5, retried: 2, exhausted: 1, skipped: 1, failed: 1 };
    mockSweepDlq.mockResolvedValue(expected);

    const result = await handler();

    expect(mockSweepDlq).toHaveBeenCalledOnce();
    expect(result).toEqual(expected);
  });

  it('returns zeros when nothing to process', async () => {
    const expected = { processed: 0, retried: 0, exhausted: 0, skipped: 0, failed: 0 };
    mockSweepDlq.mockResolvedValue(expected);

    const result = await handler();
    expect(result).toEqual(expected);
  });

  it('propagates sweep errors', async () => {
    mockSweepDlq.mockRejectedValue(new Error('DDB down'));
    await expect(handler()).rejects.toThrow('DDB down');
  });
});

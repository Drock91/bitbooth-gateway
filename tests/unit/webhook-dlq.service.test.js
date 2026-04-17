import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockListPending = vi.fn();
const mockUpdateStatus = vi.fn();
const mockIncrementRetry = vi.fn();
const mockGetAdapter = vi.fn();

vi.mock('../../src/repositories/webhook-dlq.repo.js', () => ({
  webhookDlqRepo: {
    listPending: mockListPending,
    updateStatus: mockUpdateStatus,
    incrementRetry: mockIncrementRetry,
  },
}));

vi.mock('../../src/services/routing.service.js', () => ({
  getAdapter: mockGetAdapter,
}));

vi.mock('../../src/lib/logger.js', () => {
  const noop = () => {};
  const child = () => ({ info: noop, warn: noop, error: noop, child });
  return { logger: { child } };
});

const makeEntry = (overrides = {}) => ({
  eventId: '550e8400-e29b-41d4-a716-446655440000',
  provider: 'moonpay',
  payload: '{"data":1}',
  headers: { 'x-signature': 'abc' },
  errorMessage: 'sig invalid',
  errorCode: 'UNAUTHORIZED',
  status: 'pending',
  retryCount: 0,
  createdAt: '2026-04-06T10:00:00.000Z',
  updatedAt: '2026-04-06T10:00:00.000Z',
  ...overrides,
});

describe('webhook-dlq.service', () => {
  let sweepDlq, computeBackoff;
  const realDateNow = Date.now;

  beforeEach(async () => {
    vi.resetModules();
    mockListPending.mockReset();
    mockUpdateStatus.mockReset();
    mockIncrementRetry.mockReset();
    mockGetAdapter.mockReset();
    Date.now = realDateNow;

    process.env.DLQ_MAX_RETRIES = '5';
    process.env.DLQ_SWEEP_BATCH_SIZE = '25';
    process.env.DLQ_BASE_DELAY_MS = '300000';
    process.env.DLQ_MAX_DELAY_MS = '14400000';

    const mod = await import('../../src/services/webhook-dlq.service.js');
    sweepDlq = mod.sweepDlq;
    computeBackoff = mod.computeBackoff;
  });

  afterEach(() => {
    Date.now = realDateNow;
    delete process.env.DLQ_MAX_RETRIES;
    delete process.env.DLQ_SWEEP_BATCH_SIZE;
    delete process.env.DLQ_BASE_DELAY_MS;
    delete process.env.DLQ_MAX_DELAY_MS;
  });

  // --- computeBackoff ---

  describe('computeBackoff', () => {
    it('returns base delay for retryCount 0', () => {
      expect(computeBackoff(0)).toBe(300_000);
    });

    it('doubles for each retry', () => {
      expect(computeBackoff(1)).toBe(600_000);
      expect(computeBackoff(2)).toBe(1_200_000);
      expect(computeBackoff(3)).toBe(2_400_000);
    });

    it('caps at max delay', () => {
      expect(computeBackoff(10)).toBe(14_400_000);
      expect(computeBackoff(20)).toBe(14_400_000);
    });
  });

  // --- sweepDlq ---

  describe('sweepDlq', () => {
    it('returns zeros when no pending entries', async () => {
      mockListPending.mockResolvedValue({ items: [], lastKey: null });
      const result = await sweepDlq();
      expect(result).toEqual({ processed: 0, retried: 0, exhausted: 0, skipped: 0, failed: 0 });
      expect(mockListPending).toHaveBeenCalledWith(25, undefined);
    });

    it('marks exhausted entries as resolved', async () => {
      const entry = makeEntry({ retryCount: 5 });
      mockListPending.mockResolvedValue({ items: [entry], lastKey: null });
      mockUpdateStatus.mockResolvedValue(entry);

      const result = await sweepDlq();

      expect(mockUpdateStatus).toHaveBeenCalledWith(entry.eventId, 'resolved');
      expect(result.exhausted).toBe(1);
      expect(result.processed).toBe(1);
    });

    it('skips entries within backoff window', async () => {
      const entry = makeEntry({ retryCount: 0, updatedAt: new Date().toISOString() });
      mockListPending.mockResolvedValue({ items: [entry], lastKey: null });

      const result = await sweepDlq();

      expect(result.skipped).toBe(1);
      expect(mockUpdateStatus).not.toHaveBeenCalled();
      expect(mockIncrementRetry).not.toHaveBeenCalled();
    });

    it('retries entries past backoff window and resolves on success', async () => {
      const past = new Date(Date.now() - 400_000).toISOString();
      const entry = makeEntry({ retryCount: 0, updatedAt: past });
      mockListPending.mockResolvedValue({ items: [entry], lastKey: null });
      const mockVerify = vi.fn().mockResolvedValue(true);
      mockGetAdapter.mockReturnValue({ verifyWebhook: mockVerify });
      mockUpdateStatus.mockResolvedValue(entry);

      const result = await sweepDlq();

      expect(mockGetAdapter).toHaveBeenCalledWith('moonpay');
      expect(mockVerify).toHaveBeenCalledWith(entry.payload, entry.headers);
      expect(mockUpdateStatus).toHaveBeenCalledWith(entry.eventId, 'resolved');
      expect(result.retried).toBe(1);
    });

    it('increments retry on verification failure', async () => {
      const past = new Date(Date.now() - 400_000).toISOString();
      const entry = makeEntry({ retryCount: 0, updatedAt: past });
      mockListPending.mockResolvedValue({ items: [entry], lastKey: null });
      const mockVerify = vi.fn().mockRejectedValue(new Error('still bad'));
      mockGetAdapter.mockReturnValue({ verifyWebhook: mockVerify });
      mockIncrementRetry.mockResolvedValue({ ...entry, retryCount: 1 });

      const result = await sweepDlq();

      expect(mockIncrementRetry).toHaveBeenCalledWith(entry.eventId);
      expect(result.failed).toBe(1);
    });

    it('paginates through multiple batches', async () => {
      const past = new Date(Date.now() - 400_000).toISOString();
      const entry1 = makeEntry({
        eventId: '550e8400-e29b-41d4-a716-446655440001',
        updatedAt: past,
      });
      const entry2 = makeEntry({
        eventId: '550e8400-e29b-41d4-a716-446655440002',
        updatedAt: past,
      });

      mockListPending
        .mockResolvedValueOnce({ items: [entry1], lastKey: { eventId: 'cursor1' } })
        .mockResolvedValueOnce({ items: [entry2], lastKey: null });

      const mockVerify = vi.fn().mockResolvedValue(true);
      mockGetAdapter.mockReturnValue({ verifyWebhook: mockVerify });
      mockUpdateStatus.mockResolvedValue({});

      const result = await sweepDlq();

      expect(mockListPending).toHaveBeenCalledTimes(2);
      expect(mockListPending).toHaveBeenCalledWith(25, { eventId: 'cursor1' });
      expect(result.processed).toBe(2);
      expect(result.retried).toBe(2);
    });

    it('handles mixed entry states in one batch', async () => {
      const past = new Date(Date.now() - 500_000).toISOString();
      const exhaustedEntry = makeEntry({
        eventId: '550e8400-e29b-41d4-a716-446655440010',
        retryCount: 5,
      });
      const freshEntry = makeEntry({
        eventId: '550e8400-e29b-41d4-a716-446655440011',
        retryCount: 0,
        updatedAt: new Date().toISOString(),
      });
      const dueEntry = makeEntry({
        eventId: '550e8400-e29b-41d4-a716-446655440012',
        retryCount: 0,
        updatedAt: past,
      });
      const failEntry = makeEntry({
        eventId: '550e8400-e29b-41d4-a716-446655440013',
        retryCount: 1,
        updatedAt: new Date(Date.now() - 700_000).toISOString(),
      });

      mockListPending.mockResolvedValue({
        items: [exhaustedEntry, freshEntry, dueEntry, failEntry],
        lastKey: null,
      });
      mockUpdateStatus.mockResolvedValue({});
      mockIncrementRetry.mockResolvedValue({});

      const mockVerify = vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error('nope'));
      mockGetAdapter.mockReturnValue({ verifyWebhook: mockVerify });

      const result = await sweepDlq();

      expect(result).toEqual({ processed: 4, retried: 1, exhausted: 1, skipped: 1, failed: 1 });
    });

    it('respects higher retry count backoff', async () => {
      // retryCount=3 → backoff 2,400,000ms (40 min). Entry updated 30 min ago → skip
      const thirtyMinAgo = new Date(Date.now() - 1_800_000).toISOString();
      const entry = makeEntry({ retryCount: 3, updatedAt: thirtyMinAgo });
      mockListPending.mockResolvedValue({ items: [entry], lastKey: null });

      const result = await sweepDlq();
      expect(result.skipped).toBe(1);
    });

    it('retries entry when backoff for retry count is exceeded', async () => {
      // retryCount=3 → backoff 2,400,000ms (40 min). Entry updated 50 min ago → due
      const fiftyMinAgo = new Date(Date.now() - 3_000_000).toISOString();
      const entry = makeEntry({ retryCount: 3, updatedAt: fiftyMinAgo });
      mockListPending.mockResolvedValue({ items: [entry], lastKey: null });
      const mockVerify = vi.fn().mockResolvedValue(true);
      mockGetAdapter.mockReturnValue({ verifyWebhook: mockVerify });
      mockUpdateStatus.mockResolvedValue({});

      const result = await sweepDlq();
      expect(result.retried).toBe(1);
    });

    it('marks entry at exactly MAX_RETRIES as exhausted', async () => {
      const entry = makeEntry({ retryCount: 5 });
      mockListPending.mockResolvedValue({ items: [entry], lastKey: null });
      mockUpdateStatus.mockResolvedValue(entry);

      const result = await sweepDlq();
      expect(result.exhausted).toBe(1);
      expect(mockUpdateStatus).toHaveBeenCalledWith(entry.eventId, 'resolved');
    });

    it('marks entry above MAX_RETRIES as exhausted', async () => {
      const entry = makeEntry({ retryCount: 10 });
      mockListPending.mockResolvedValue({ items: [entry], lastKey: null });
      mockUpdateStatus.mockResolvedValue(entry);

      const result = await sweepDlq();
      expect(result.exhausted).toBe(1);
    });
  });

  // --- env var defaults (|| fallback branches) ---

  describe('env var defaults', () => {
    it('uses default MAX_RETRIES when env var is unset', async () => {
      vi.resetModules();
      delete process.env.DLQ_MAX_RETRIES;
      delete process.env.DLQ_SWEEP_BATCH_SIZE;
      delete process.env.DLQ_BASE_DELAY_MS;
      delete process.env.DLQ_MAX_DELAY_MS;

      const mod = await import('../../src/services/webhook-dlq.service.js');
      // Default MAX_RETRIES = 5; entry at 5 should be exhausted
      const entry = makeEntry({ retryCount: 5 });
      mockListPending.mockResolvedValue({ items: [entry], lastKey: null });
      mockUpdateStatus.mockResolvedValue(entry);

      const result = await mod.sweepDlq();
      expect(result.exhausted).toBe(1);
    });

    it('uses default BATCH_SIZE (25) when env var is unset', async () => {
      vi.resetModules();
      delete process.env.DLQ_MAX_RETRIES;
      delete process.env.DLQ_SWEEP_BATCH_SIZE;
      delete process.env.DLQ_BASE_DELAY_MS;
      delete process.env.DLQ_MAX_DELAY_MS;

      const mod = await import('../../src/services/webhook-dlq.service.js');
      mockListPending.mockResolvedValue({ items: [], lastKey: null });

      await mod.sweepDlq();
      expect(mockListPending).toHaveBeenCalledWith(25, undefined);
    });

    it('uses default BASE_DELAY_MS (300000) when env var is unset', async () => {
      vi.resetModules();
      delete process.env.DLQ_MAX_RETRIES;
      delete process.env.DLQ_SWEEP_BATCH_SIZE;
      delete process.env.DLQ_BASE_DELAY_MS;
      delete process.env.DLQ_MAX_DELAY_MS;

      const mod = await import('../../src/services/webhook-dlq.service.js');
      // Default base = 300_000; retryCount 0 → backoff = 300_000
      expect(mod.computeBackoff(0)).toBe(300_000);
    });

    it('uses default MAX_DELAY_MS (14400000) when env var is unset', async () => {
      vi.resetModules();
      delete process.env.DLQ_MAX_RETRIES;
      delete process.env.DLQ_SWEEP_BATCH_SIZE;
      delete process.env.DLQ_BASE_DELAY_MS;
      delete process.env.DLQ_MAX_DELAY_MS;

      const mod = await import('../../src/services/webhook-dlq.service.js');
      // Default max = 14_400_000; high retry → capped
      expect(mod.computeBackoff(20)).toBe(14_400_000);
    });
  });

  // --- additional edge cases ---

  describe('edge cases', () => {
    it('handles exact backoff boundary (dueAt === Date.now()) — entry is not skipped', async () => {
      const baseDelay = 300_000;
      const updatedAt = new Date(Date.now() - baseDelay).toISOString();
      const entry = makeEntry({ retryCount: 0, updatedAt });
      mockListPending.mockResolvedValue({ items: [entry], lastKey: null });
      const mockVerify = vi.fn().mockResolvedValue(true);
      mockGetAdapter.mockReturnValue({ verifyWebhook: mockVerify });
      mockUpdateStatus.mockResolvedValue({});

      // Date.now() === dueAt means !(Date.now() < dueAt) → should proceed
      const result = await sweepDlq();
      expect(result.retried).toBe(1);
      expect(result.skipped).toBe(0);
    });

    it('processes entries with retryCount just below MAX_RETRIES', async () => {
      const past = new Date(Date.now() - 15_000_000).toISOString();
      const entry = makeEntry({ retryCount: 4, updatedAt: past });
      mockListPending.mockResolvedValue({ items: [entry], lastKey: null });
      const mockVerify = vi.fn().mockRejectedValue(new Error('fail'));
      mockGetAdapter.mockReturnValue({ verifyWebhook: mockVerify });
      mockIncrementRetry.mockResolvedValue({});

      const result = await sweepDlq();
      expect(result.failed).toBe(1);
      expect(result.exhausted).toBe(0);
    });

    it('handles three pages of pagination', async () => {
      const past = new Date(Date.now() - 400_000).toISOString();
      const e1 = makeEntry({ eventId: 'aaa-001', updatedAt: past });
      const e2 = makeEntry({ eventId: 'aaa-002', updatedAt: past });
      const e3 = makeEntry({ eventId: 'aaa-003', updatedAt: past });

      mockListPending
        .mockResolvedValueOnce({ items: [e1], lastKey: { eventId: 'c1' } })
        .mockResolvedValueOnce({ items: [e2], lastKey: { eventId: 'c2' } })
        .mockResolvedValueOnce({ items: [e3], lastKey: null });

      const mockVerify = vi.fn().mockResolvedValue(true);
      mockGetAdapter.mockReturnValue({ verifyWebhook: mockVerify });
      mockUpdateStatus.mockResolvedValue({});

      const result = await sweepDlq();
      expect(mockListPending).toHaveBeenCalledTimes(3);
      expect(result.processed).toBe(3);
      expect(result.retried).toBe(3);
    });

    it('uses custom env var values when set', async () => {
      vi.resetModules();
      process.env.DLQ_MAX_RETRIES = '2';
      process.env.DLQ_SWEEP_BATCH_SIZE = '10';
      process.env.DLQ_BASE_DELAY_MS = '1000';
      process.env.DLQ_MAX_DELAY_MS = '5000';

      const mod = await import('../../src/services/webhook-dlq.service.js');
      // MAX_RETRIES=2 → entry at retryCount 2 is exhausted
      const entry = makeEntry({ retryCount: 2 });
      mockListPending.mockResolvedValue({ items: [entry], lastKey: null });
      mockUpdateStatus.mockResolvedValue(entry);

      const result = await mod.sweepDlq();
      expect(result.exhausted).toBe(1);
      expect(mockListPending).toHaveBeenCalledWith(10, undefined);
      expect(mod.computeBackoff(0)).toBe(1000);
      expect(mod.computeBackoff(10)).toBe(5000);
    });
  });
});

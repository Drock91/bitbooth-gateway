import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetAdapter = vi.fn();
const mockVerifyWebhook = vi.fn();
const mockDlqRecord = vi.fn();

vi.mock('../../src/services/routing.service.js', () => ({
  getAdapter: (...args) => mockGetAdapter(...args),
}));
vi.mock('../../src/lib/logger.js', () => ({
  withCorrelation: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  flushLogger: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/repositories/webhook-dlq.repo.js', () => ({
  webhookDlqRepo: { record: (...args) => mockDlqRecord(...args) },
}));
vi.mock('node:crypto', () => ({
  randomUUID: () => '00000000-0000-4000-a000-000000000001',
}));

import { handler } from '../../src/handlers/webhook.handler.js';

function makeEvent(provider = 'moonpay', body = '{"data":1}', headers = {}) {
  return {
    pathParameters: { provider },
    body,
    headers,
  };
}

describe('webhook.handler', () => {
  beforeEach(() => {
    mockGetAdapter.mockReset();
    mockVerifyWebhook.mockReset();
    mockDlqRecord.mockReset();
    mockGetAdapter.mockReturnValue({ verifyWebhook: mockVerifyWebhook });
    mockDlqRecord.mockResolvedValue({});
  });

  // --- success path ---

  it('returns 200 with ok:true when webhook verifies', async () => {
    mockVerifyWebhook.mockResolvedValue(true);
    const res = await handler(makeEvent('coinbase'));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it('passes provider from path params to getAdapter', async () => {
    mockVerifyWebhook.mockResolvedValue(true);
    await handler(makeEvent('kraken'));
    expect(mockGetAdapter).toHaveBeenCalledWith('kraken');
  });

  it('passes body and lowercased headers to verifyWebhook', async () => {
    mockVerifyWebhook.mockResolvedValue(true);
    await handler(
      makeEvent('moonpay', 'raw-body', {
        'X-Signature': 'abc',
        'Content-Type': 'application/json',
      }),
    );
    expect(mockVerifyWebhook).toHaveBeenCalledWith('raw-body', {
      'x-signature': 'abc',
      'content-type': 'application/json',
    });
  });

  it('uses empty string when event.body is null', async () => {
    mockVerifyWebhook.mockResolvedValue(true);
    await handler({ pathParameters: { provider: 'moonpay' }, body: null, headers: {} });
    expect(mockVerifyWebhook).toHaveBeenCalledWith('', {});
  });

  it('does not record to DLQ on success', async () => {
    mockVerifyWebhook.mockResolvedValue(true);
    await handler(makeEvent('coinbase'));
    expect(mockDlqRecord).not.toHaveBeenCalled();
  });

  // --- verification failure ---

  it('returns 401 when verifyWebhook returns false', async () => {
    mockVerifyWebhook.mockResolvedValue(false);
    const res = await handler(makeEvent('binance'));
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toBe('webhook signature invalid');
  });

  it('includes correlationId in 401 response', async () => {
    mockVerifyWebhook.mockResolvedValue(false);
    const res = await handler(makeEvent());
    const body = JSON.parse(res.body);
    expect(body.correlationId).toMatch(/^[0-9a-f]{8}-/);
  });

  // --- invalid provider ---

  it('returns 500 for unsupported provider (Zod parse throws)', async () => {
    const res = await handler(makeEvent('fakeprovider'));
    expect(res.statusCode).toBe(500);
  });

  it('returns error when provider path param is missing', async () => {
    const res = await handler({ pathParameters: {}, body: '', headers: {} });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('returns error when pathParameters is undefined', async () => {
    const res = await handler({ body: '', headers: {} });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  // --- adapter throws ---

  it('returns 500 when verifyWebhook throws unexpectedly', async () => {
    mockVerifyWebhook.mockRejectedValue(new Error('network timeout'));
    const res = await handler(makeEvent('uphold'));
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  // --- headers edge cases ---

  it('handles null headers gracefully', async () => {
    mockVerifyWebhook.mockResolvedValue(true);
    const res = await handler({
      pathParameters: { provider: 'moonpay' },
      body: '{}',
      headers: null,
    });
    expect(res.statusCode).toBe(200);
  });

  it('handles undefined headers gracefully', async () => {
    mockVerifyWebhook.mockResolvedValue(true);
    const res = await handler({ pathParameters: { provider: 'moonpay' }, body: '{}' });
    expect(res.statusCode).toBe(200);
  });

  it('filters out undefined header values', async () => {
    mockVerifyWebhook.mockResolvedValue(true);
    await handler(makeEvent('moonpay', '{}', { 'x-sig': 'val', 'x-empty': undefined }));
    const passedHeaders = mockVerifyWebhook.mock.calls[0][1];
    expect(passedHeaders).not.toHaveProperty('x-empty');
    expect(passedHeaders['x-sig']).toBe('val');
  });

  // --- DLQ integration ---

  it('records to DLQ when verifyWebhook returns false', async () => {
    mockVerifyWebhook.mockResolvedValue(false);
    await handler(makeEvent('binance', '{"test":1}', { 'x-sig': 'bad' }));
    expect(mockDlqRecord).toHaveBeenCalledWith({
      eventId: '00000000-0000-4000-a000-000000000001',
      provider: 'binance',
      payload: '{"test":1}',
      headers: { 'x-sig': 'bad' },
      errorMessage: 'webhook signature invalid',
      errorCode: 'UNAUTHORIZED',
    });
  });

  it('records to DLQ when adapter throws', async () => {
    mockVerifyWebhook.mockRejectedValue(new Error('connection refused'));
    await handler(makeEvent('uphold', 'body-data', {}));
    expect(mockDlqRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'uphold',
        payload: 'body-data',
        errorMessage: 'connection refused',
        errorCode: 'INTERNAL_ERROR',
      }),
    );
  });

  it('records to DLQ on Zod parse error with provider fallback', async () => {
    const res = await handler(makeEvent('fakeprovider', 'x', { h: '1' }));
    expect(res.statusCode).toBe(500);
    expect(mockDlqRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'fakeprovider',
        payload: 'x',
        errorCode: 'INTERNAL_ERROR',
      }),
    );
  });

  it('truncates payload to 65536 bytes in DLQ record', async () => {
    mockVerifyWebhook.mockResolvedValue(false);
    const longBody = 'A'.repeat(100000);
    await handler(makeEvent('moonpay', longBody));
    const recorded = mockDlqRecord.mock.calls[0][0];
    expect(recorded.payload.length).toBe(65536);
  });

  it('uses empty string for null body in DLQ', async () => {
    mockVerifyWebhook.mockResolvedValue(false);
    await handler({ pathParameters: { provider: 'moonpay' }, body: null, headers: {} });
    const recorded = mockDlqRecord.mock.calls[0][0];
    expect(recorded.payload).toBe('');
  });

  it('still returns error response even if DLQ recording fails', async () => {
    mockVerifyWebhook.mockResolvedValue(false);
    mockDlqRecord.mockRejectedValue(new Error('DDB unavailable'));
    const res = await handler(makeEvent('coinbase'));
    expect(res.statusCode).toBe(401);
  });

  it('uses "unknown" provider when pathParameters.provider is undefined', async () => {
    await handler({ body: '', headers: {} });
    const recorded = mockDlqRecord.mock.calls[0][0];
    expect(recorded.provider).toBe('unknown');
  });

  it('uses original headers object (not lowercased) in DLQ record', async () => {
    mockVerifyWebhook.mockResolvedValue(false);
    await handler(makeEvent('moonpay', '{}', { 'X-Signature': 'abc' }));
    const recorded = mockDlqRecord.mock.calls[0][0];
    expect(recorded.headers).toEqual({ 'X-Signature': 'abc' });
  });

  it('falls back to empty object for null headers in DLQ record', async () => {
    mockVerifyWebhook.mockResolvedValue(false);
    const res = await handler({
      pathParameters: { provider: 'moonpay' },
      body: '{}',
      headers: null,
    });
    expect(res.statusCode).toBe(401);
    const recorded = mockDlqRecord.mock.calls[0][0];
    expect(recorded.headers).toEqual({});
  });

  it('uses "Unknown error" when thrown error has no message', async () => {
    mockVerifyWebhook.mockRejectedValue(Object.create(null));
    const res = await handler(makeEvent('moonpay', '{}'));
    expect(res.statusCode).toBe(500);
    const recorded = mockDlqRecord.mock.calls[0][0];
    expect(recorded.errorMessage).toBe('Unknown error');
    expect(recorded.errorCode).toBe('INTERNAL_ERROR');
  });
});

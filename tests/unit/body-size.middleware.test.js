import { describe, it, expect, vi } from 'vitest';
import { withBodySizeLimit, DEFAULT_MAX_BYTES } from '../../src/middleware/body-size.middleware.js';

function makeEvent(body = null) {
  return { httpMethod: 'POST', path: '/v1/resource', headers: {}, body };
}

function makeResponse(status = 200) {
  return { statusCode: status, headers: { 'content-type': 'application/json' }, body: '{}' };
}

describe('body-size.middleware', () => {
  // --- DEFAULT_MAX_BYTES constant ---

  it('exports DEFAULT_MAX_BYTES as 102400 (100 KB)', () => {
    expect(DEFAULT_MAX_BYTES).toBe(102400);
  });

  // --- passes through when body is within limit ---

  it('passes through when body is null', async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse());
    const wrapped = withBodySizeLimit(inner);

    const res = await wrapped(makeEvent(null));

    expect(inner).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  it('passes through when body is empty string', async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse());
    const wrapped = withBodySizeLimit(inner);

    const res = await wrapped(makeEvent(''));

    expect(inner).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  it('passes through when body is under the default limit', async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse());
    const wrapped = withBodySizeLimit(inner);
    const body = JSON.stringify({ data: 'x'.repeat(1000) });

    const res = await wrapped(makeEvent(body));

    expect(inner).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  it('passes through when body is exactly at the default limit', async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse());
    const wrapped = withBodySizeLimit(inner);
    const body = 'a'.repeat(DEFAULT_MAX_BYTES);

    const res = await wrapped(makeEvent(body));

    expect(inner).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  // --- rejects when body exceeds limit ---

  it('returns 413 when body exceeds the default limit by 1 byte', async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse());
    const wrapped = withBodySizeLimit(inner);
    const body = 'a'.repeat(DEFAULT_MAX_BYTES + 1);

    const res = await wrapped(makeEvent(body));

    expect(inner).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(413);
    const parsed = JSON.parse(res.body);
    expect(parsed.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(parsed.error.maxBytes).toBe(DEFAULT_MAX_BYTES);
  });

  it('returns 413 when body is significantly over the limit', async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse());
    const wrapped = withBodySizeLimit(inner);
    const body = 'x'.repeat(500_000);

    const res = await wrapped(makeEvent(body));

    expect(inner).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(413);
  });

  it('includes correct error message in 413 response', async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse());
    const wrapped = withBodySizeLimit(inner);
    const body = 'a'.repeat(DEFAULT_MAX_BYTES + 1);

    const res = await wrapped(makeEvent(body));

    const parsed = JSON.parse(res.body);
    expect(parsed.error.message).toBe(`Request body exceeds ${DEFAULT_MAX_BYTES} bytes`);
  });

  // --- custom maxBytes ---

  it('respects custom maxBytes option', async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse());
    const wrapped = withBodySizeLimit(inner, { maxBytes: 50 });

    const smallRes = await wrapped(makeEvent('a'.repeat(50)));
    expect(smallRes.statusCode).toBe(200);
    expect(inner).toHaveBeenCalledTimes(1);

    const bigRes = await wrapped(makeEvent('a'.repeat(51)));
    expect(bigRes.statusCode).toBe(413);
    const parsed = JSON.parse(bigRes.body);
    expect(parsed.error.maxBytes).toBe(50);
  });

  it('uses default when opts is empty object', async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse());
    const wrapped = withBodySizeLimit(inner, {});
    const body = 'a'.repeat(DEFAULT_MAX_BYTES);

    const res = await wrapped(makeEvent(body));

    expect(res.statusCode).toBe(200);
  });

  // --- multi-byte characters ---

  it('measures byte length not character count for multi-byte chars', async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse());
    const wrapped = withBodySizeLimit(inner, { maxBytes: 10 });
    // Each emoji is 4 bytes in UTF-8; 3 emojis = 12 bytes > 10
    const body = '\u{1F600}\u{1F600}\u{1F600}';

    const res = await wrapped(makeEvent(body));

    expect(res.statusCode).toBe(413);
    expect(inner).not.toHaveBeenCalled();
  });

  it('passes multi-byte body that fits within byte limit', async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse());
    const wrapped = withBodySizeLimit(inner, { maxBytes: 20 });
    // 2 emojis = 8 bytes < 20
    const body = '\u{1F600}\u{1F600}';

    const res = await wrapped(makeEvent(body));

    expect(inner).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  // --- context passthrough ---

  it('passes event and context through to inner handler', async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse());
    const wrapped = withBodySizeLimit(inner);
    const event = makeEvent('{"small": true}');
    const ctx = { correlationId: 'test-456' };

    await wrapped(event, ctx);

    expect(inner).toHaveBeenCalledWith(event, ctx);
  });

  it('returns inner handler response unchanged', async () => {
    const expected = { statusCode: 201, headers: { 'x-custom': 'yes' }, body: '{"created":true}' };
    const inner = vi.fn().mockResolvedValue(expected);
    const wrapped = withBodySizeLimit(inner);

    const res = await wrapped(makeEvent('{}'));

    expect(res).toBe(expected);
  });

  // --- 413 response format ---

  it('returns proper JSON content-type on 413', async () => {
    const inner = vi.fn();
    const wrapped = withBodySizeLimit(inner);
    const body = 'x'.repeat(DEFAULT_MAX_BYTES + 1);

    const res = await wrapped(makeEvent(body));

    expect(res.headers['content-type']).toBe('application/json');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  // --- GET requests with no body ---

  it('passes through GET requests with undefined body', async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse());
    const wrapped = withBodySizeLimit(inner);
    const event = { httpMethod: 'GET', path: '/v1/health', headers: {}, body: undefined };

    const res = await wrapped(event);

    expect(inner).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });
});

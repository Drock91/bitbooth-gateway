import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('lib/http', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  async function freshImport(envOverrides = {}) {
    Object.assign(process.env, envOverrides);
    return import('../../src/lib/http.js');
  }

  describe('getAdapterTimeoutMs', () => {
    it('returns 10000 by default', async () => {
      delete process.env.ADAPTER_HTTP_TIMEOUT_MS;
      const { getAdapterTimeoutMs } = await freshImport();
      expect(getAdapterTimeoutMs()).toBe(10_000);
    });

    it('reads ADAPTER_HTTP_TIMEOUT_MS env var', async () => {
      const { getAdapterTimeoutMs } = await freshImport({ ADAPTER_HTTP_TIMEOUT_MS: '5000' });
      expect(getAdapterTimeoutMs()).toBe(5000);
    });

    it('falls back to default for non-numeric env var', async () => {
      const { getAdapterTimeoutMs } = await freshImport({ ADAPTER_HTTP_TIMEOUT_MS: 'abc' });
      expect(getAdapterTimeoutMs()).toBe(10_000);
    });

    it('falls back to default for zero', async () => {
      const { getAdapterTimeoutMs } = await freshImport({ ADAPTER_HTTP_TIMEOUT_MS: '0' });
      expect(getAdapterTimeoutMs()).toBe(10_000);
    });

    it('falls back to default for negative value', async () => {
      const { getAdapterTimeoutMs } = await freshImport({ ADAPTER_HTTP_TIMEOUT_MS: '-100' });
      expect(getAdapterTimeoutMs()).toBe(10_000);
    });

    it('falls back to default for Infinity', async () => {
      const { getAdapterTimeoutMs } = await freshImport({ ADAPTER_HTTP_TIMEOUT_MS: 'Infinity' });
      expect(getAdapterTimeoutMs()).toBe(10_000);
    });

    it('accepts fractional ms values', async () => {
      const { getAdapterTimeoutMs } = await freshImport({ ADAPTER_HTTP_TIMEOUT_MS: '1500.5' });
      expect(getAdapterTimeoutMs()).toBe(1500.5);
    });
  });

  describe('fetchWithTimeout', () => {
    let fetchWithTimeout;
    let mockFetch;

    beforeEach(async () => {
      delete process.env.ADAPTER_HTTP_TIMEOUT_MS;
      mockFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
      vi.stubGlobal('fetch', mockFetch);
      ({ fetchWithTimeout } = await freshImport());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('passes url and options to fetch', async () => {
      await fetchWithTimeout('https://api.example.com', {
        method: 'POST',
        headers: { 'x-test': '1' },
      });
      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.example.com');
      expect(opts.method).toBe('POST');
      expect(opts.headers).toEqual({ 'x-test': '1' });
    });

    it('returns the fetch response on success', async () => {
      const res = await fetchWithTimeout('https://api.example.com');
      expect(res).toBeInstanceOf(Response);
      expect(res.status).toBe(200);
    });

    it('attaches an AbortController signal', async () => {
      await fetchWithTimeout('https://api.example.com');
      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.signal).toBeInstanceOf(AbortSignal);
    });

    it('throws UpstreamError on abort (timeout)', async () => {
      const abortErr = new DOMException('The operation was aborted', 'AbortError');
      mockFetch.mockRejectedValueOnce(abortErr);
      await expect(
        fetchWithTimeout('https://slow.example.com', { timeoutMs: 1, retry: { maxAttempts: 1 } }),
      ).rejects.toThrow('Upstream');
    });

    it('includes timeout metadata in UpstreamError details', async () => {
      const abortErr = new DOMException('The operation was aborted', 'AbortError');
      mockFetch.mockRejectedValueOnce(abortErr);
      try {
        await fetchWithTimeout('https://slow.example.com', {
          timeoutMs: 3000,
          retry: { maxAttempts: 1 },
        });
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err.details.reason).toBe('timeout');
        expect(err.details.url).toBe('https://slow.example.com');
        expect(err.details.timeoutMs).toBe(3000);
      }
    });

    it('rethrows non-abort errors unchanged', async () => {
      const netErr = new TypeError('fetch failed');
      mockFetch.mockRejectedValueOnce(netErr);
      await expect(
        fetchWithTimeout('https://down.example.com', { retry: { maxAttempts: 1 } }),
      ).rejects.toThrow('fetch failed');
    });

    it('re-thrown non-abort error is the exact same object', async () => {
      const netErr = new Error('connection refused');
      netErr.code = 'ECONNREFUSED';
      mockFetch.mockRejectedValue(netErr);
      try {
        await fetchWithTimeout('https://down.example.com', { retry: { maxAttempts: 1 } });
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBe(netErr);
      }
    });

    it('uses custom timeoutMs when provided', async () => {
      mockFetch.mockImplementationOnce(
        (_url, opts) =>
          new Promise((_resolve, reject) => {
            opts.signal.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      );
      await expect(
        fetchWithTimeout('https://api.example.com', { timeoutMs: 50, retry: { maxAttempts: 1 } }),
      ).rejects.toThrow('Upstream');
    }, 10_000);

    it('does not pass timeoutMs or retry to underlying fetch', async () => {
      await fetchWithTimeout('https://api.example.com', {
        timeoutMs: 5000,
        retry: { maxAttempts: 1 },
      });
      const [, opts] = mockFetch.mock.calls[0];
      expect(opts).not.toHaveProperty('timeoutMs');
      expect(opts).not.toHaveProperty('retry');
    });

    it('clears timer on success', async () => {
      const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
      await fetchWithTimeout('https://api.example.com');
      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    });

    it('clears timer on error', async () => {
      const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
      mockFetch.mockRejectedValueOnce(new TypeError('network error'));
      await fetchWithTimeout('https://api.example.com').catch(() => {});
      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    });
  });
});

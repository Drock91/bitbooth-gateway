import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let mod;
async function loadModule() {
  vi.resetModules();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mod = await import('../../scripts/demo-agent-scrape.js');
  return mod;
}

describe('scripts/demo-agent-scrape.js', () => {
  describe('buildChallenge', () => {
    beforeEach(async () => {
      await loadModule();
    });
    afterEach(() => vi.restoreAllMocks());

    it('returns challenge with Base accept entry', () => {
      const c = mod.buildChallenge();
      expect(c.accepts).toHaveLength(1);
      expect(c.accepts[0].network).toBe('eip155:8453');
      expect(c.accepts[0].scheme).toBe('exact');
    });

    it('includes nonce, expiresAt, resource, payTo, chainId', () => {
      const c = mod.buildChallenge();
      expect(c.nonce).toMatch(/^[a-f0-9]{32}$/);
      expect(c.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
      expect(c.resource).toBe('/v1/fetch');
      expect(c.payTo).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(c.chainId).toBe(8453);
    });

    it('uses provided nonce and expiresAt', () => {
      const c = mod.buildChallenge({ nonce: 'custom', expiresAt: 1234 });
      expect(c.nonce).toBe('custom');
      expect(c.expiresAt).toBe(1234);
    });

    it('sets amountWei to 5000 ($0.005 USDC)', () => {
      const c = mod.buildChallenge();
      expect(c.amountWei).toBe('5000');
      expect(c.assetSymbol).toBe('USDC');
    });

    it('Base accept includes USDC contract address', () => {
      const base = mod.buildChallenge().accepts[0];
      expect(base.asset).toMatch(/^USDC@0x[a-fA-F0-9]{40}$/);
      expect(base.amount).toBe('5000');
    });
  });

  describe('buildPaymentHeader', () => {
    beforeEach(async () => {
      await loadModule();
    });
    afterEach(() => vi.restoreAllMocks());

    it('returns nonce, txHash, signature, network', () => {
      const h = mod.buildPaymentHeader('nonce123');
      expect(h.nonce).toBe('nonce123');
      expect(h.txHash).toMatch(/^0x[a-f0-9]{64}$/);
      expect(h.signature).toMatch(/^0x[a-f0-9]+$/);
      expect(h.network).toBe('eip155:8453');
    });

    it('uses provided txHash', () => {
      const h = mod.buildPaymentHeader('n', '0xabc');
      expect(h.txHash).toBe('0xabc');
    });

    it('generates unique txHash each call', () => {
      const h1 = mod.buildPaymentHeader('n');
      const h2 = mod.buildPaymentHeader('n');
      expect(h1.txHash).not.toBe(h2.txHash);
    });
  });

  describe('buildFetchResult', () => {
    beforeEach(async () => {
      await loadModule();
    });
    afterEach(() => vi.restoreAllMocks());

    it('returns title, markdown, metadata', () => {
      const r = mod.buildFetchResult();
      expect(r.title).toBe('Example Domain');
      expect(r.markdown).toContain('# Example Domain');
      expect(r.metadata.truncated).toBe(false);
      expect(r.metadata.contentLength).toBe(1256);
    });

    it('uses provided url in metadata', () => {
      const r = mod.buildFetchResult('https://test.com');
      expect(r.metadata.url).toBe('https://test.com');
    });

    it('metadata.fetchedAt is valid ISO timestamp', () => {
      const r = mod.buildFetchResult();
      expect(new Date(r.metadata.fetchedAt).getTime()).not.toBeNaN();
    });

    it('markdown contains link to iana', () => {
      const r = mod.buildFetchResult();
      expect(r.markdown).toContain('iana.org');
    });
  });

  describe('runMock', () => {
    let logSpy;
    beforeEach(async () => {
      await loadModule();
      logSpy = console.log;
    });
    afterEach(() => vi.restoreAllMocks());

    it('runs to completion without errors', async () => {
      await expect(mod.runMock()).resolves.toBeUndefined();
    });

    it('prints 402 challenge', async () => {
      await mod.runMock();
      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('402 Payment Required');
      expect(output).toContain('PAYMENT_REQUIRED');
    });

    it('prints curl equivalents', async () => {
      await mod.runMock();
      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('curl');
      expect(output).toContain('X-PAYMENT');
    });

    it('prints 200 OK with fetch result', async () => {
      await mod.runMock();
      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('200 OK');
      expect(output).toContain('Example Domain');
    });

    it('prints payment confirmation on chain', async () => {
      await mod.runMock();
      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('USDC.transfer()');
      expect(output).toContain('Confirmed in 2 blocks');
    });

    it('prints summary with x402 explanation', async () => {
      await mod.runMock();
      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('x402');
      expect(output).toContain('$0.005 USDC');
    });

    it('prints Base chain details', async () => {
      await mod.runMock();
      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('eip155:8453');
      expect(output).toContain('USDC@0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    });
  });

  describe('runLive', () => {
    let exitSpy;
    beforeEach(async () => {
      await loadModule();
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit');
      });
    });
    afterEach(() => {
      exitSpy.mockRestore();
      vi.restoreAllMocks();
    });

    it('exits with error when BASE_URL is empty', async () => {
      await expect(mod.runLive()).rejects.toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});

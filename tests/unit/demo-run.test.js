import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function loadDemo() {
  delete require.cache[require.resolve('../../demo/run.cjs')];
  return require('../../demo/run.cjs');
}

describe('demo/run.cjs', () => {
  describe('buildChallenge', () => {
    it('returns challenge with dual-chain accepts', () => {
      const { buildChallenge } = loadDemo();
      const c = buildChallenge();
      expect(c.accepts).toHaveLength(2);
      expect(c.accepts[0].network).toBe('eip155:8453');
      expect(c.accepts[1].network).toMatch(/^solana:/);
    });

    it('includes nonce, expiresAt, resource, payTo, chainId', () => {
      const { buildChallenge } = loadDemo();
      const c = buildChallenge();
      expect(c.nonce).toMatch(/^[a-f0-9]{32}$/);
      expect(c.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
      expect(c.resource).toBe('/v1/fetch');
      expect(c.payTo).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(c.chainId).toBe(8453);
    });

    it('uses provided nonce and expiresAt', () => {
      const { buildChallenge } = loadDemo();
      const c = buildChallenge({ nonce: 'abc123', expiresAt: 9999 });
      expect(c.nonce).toBe('abc123');
      expect(c.expiresAt).toBe(9999);
    });

    it('sets amountWei to $0.005 USDC', () => {
      const { buildChallenge } = loadDemo();
      const c = buildChallenge();
      expect(c.amountWei).toBe('5000');
      expect(c.assetSymbol).toBe('USDC');
    });

    it('Base accept includes USDC contract address', () => {
      const { buildChallenge } = loadDemo();
      const base = buildChallenge().accepts[0];
      expect(base.asset).toMatch(/^USDC@0x[a-fA-F0-9]{40}$/);
      expect(base.scheme).toBe('exact');
      expect(base.amount).toBe('5000');
    });

    it('Solana accept includes USDC mint address', () => {
      const { buildChallenge } = loadDemo();
      const sol = buildChallenge().accepts[1];
      expect(sol.asset).toMatch(/^USDC@[1-9A-HJ-NP-Za-km-z]+$/);
      expect(sol.payTo).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    });
  });

  describe('buildPaymentHeader', () => {
    it('returns nonce, txHash, signature, network', () => {
      const { buildPaymentHeader } = loadDemo();
      const h = buildPaymentHeader('nonce123');
      expect(h.nonce).toBe('nonce123');
      expect(h.txHash).toMatch(/^0x[a-f0-9]{64}$/);
      expect(h.signature).toMatch(/^0x[a-f0-9]+$/);
      expect(h.network).toBe('eip155:8453');
    });

    it('uses provided txHash', () => {
      const { buildPaymentHeader } = loadDemo();
      const h = buildPaymentHeader('n', '0xabc');
      expect(h.txHash).toBe('0xabc');
    });

    it('generates random txHash when omitted', () => {
      const { buildPaymentHeader } = loadDemo();
      const h1 = buildPaymentHeader('n');
      const h2 = buildPaymentHeader('n');
      expect(h1.txHash).not.toBe(h2.txHash);
    });
  });

  describe('buildFetchResult', () => {
    it('returns title, markdown, metadata', () => {
      const { buildFetchResult } = loadDemo();
      const r = buildFetchResult();
      expect(r.title).toBe('Example Domain');
      expect(r.markdown).toContain('# Example Domain');
      expect(r.metadata.url).toBe('https://example.com');
      expect(r.metadata.truncated).toBe(false);
      expect(r.metadata.contentLength).toBe(1256);
    });

    it('metadata.fetchedAt is a valid ISO timestamp', () => {
      const { buildFetchResult } = loadDemo();
      const r = buildFetchResult();
      const d = new Date(r.metadata.fetchedAt);
      expect(d.getTime()).not.toBeNaN();
    });
  });

  describe('runMock', () => {
    let spy;
    beforeEach(() => {
      spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => {
      spy.mockRestore();
    });

    it('runs to completion without errors', async () => {
      const { runMock } = loadDemo();
      await expect(runMock()).resolves.toBeUndefined();
    });

    it('prints x402 challenge with dual accepts', async () => {
      const { runMock } = loadDemo();
      await runMock();
      const output = spy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('eip155:8453');
      expect(output).toContain('solana:');
      expect(output).toContain('402 Payment Required');
    });

    it('prints fetch result markdown', async () => {
      const { runMock } = loadDemo();
      await runMock();
      const output = spy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Example Domain');
      expect(output).toContain('200 OK');
    });

    it('prints wallet intel section', async () => {
      const { runMock } = loadDemo();
      await runMock();
      const output = spy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Wallet Intel');
      expect(output).toContain('Balance:');
      expect(output).toContain('Nonce:');
    });

    it('prints payment confirmation', async () => {
      const { runMock } = loadDemo();
      await runMock();
      const output = spy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Confirmed at block');
      expect(output).toContain('X-PAYMENT');
    });
  });

  describe('runLive', () => {
    let errSpy;
    let exitSpy;
    beforeEach(() => {
      errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit');
      });
    });
    afterEach(() => {
      errSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('exits with error when BASE_URL is empty', async () => {
      const { runLive } = loadDemo();
      await expect(runLive()).rejects.toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});

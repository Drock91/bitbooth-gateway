import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UpstreamError } from '../../src/lib/errors.js';

const { mockXrplEvmVerify, mockBaseVerify, mockNativeXrplVerify, mockAdapters, mockGetConfig } =
  vi.hoisted(() => ({
    mockXrplEvmVerify: vi.fn(),
    mockBaseVerify: vi.fn(),
    mockNativeXrplVerify: vi.fn(),
    mockGetConfig: vi.fn(() => ({ xrpl: undefined })),
    mockAdapters: {
      moonpay: { name: 'moonpay', quote: vi.fn() },
      coinbase: { name: 'coinbase', quote: vi.fn() },
      kraken: { name: 'kraken', quote: vi.fn() },
      binance: { name: 'binance', quote: vi.fn() },
      uphold: { name: 'uphold', quote: vi.fn() },
    },
  }));

vi.mock('../../src/adapters/moonpay/index.js', () => ({ moonpayAdapter: mockAdapters.moonpay }));
vi.mock('../../src/adapters/coinbase/index.js', () => ({ coinbaseAdapter: mockAdapters.coinbase }));
vi.mock('../../src/adapters/kraken/index.js', () => ({ krakenAdapter: mockAdapters.kraken }));
vi.mock('../../src/adapters/binance/index.js', () => ({ binanceAdapter: mockAdapters.binance }));
vi.mock('../../src/adapters/uphold/index.js', () => ({ upholdAdapter: mockAdapters.uphold }));
vi.mock('../../src/adapters/xrpl-evm/index.js', () => ({ verifyPayment: mockXrplEvmVerify }));
vi.mock('../../src/adapters/base/index.js', () => ({
  verifyPayment: mockBaseVerify,
  BASE_CHAIN_ID: 8453,
  BASE_SEPOLIA_CHAIN_ID: 84532,
}));
vi.mock('../../src/adapters/xrpl/index.js', () => ({
  verifyPayment: mockNativeXrplVerify,
}));
vi.mock('../../src/adapters/solana/index.js', () => ({
  verifyPayment: vi.fn(),
}));
vi.mock('../../src/lib/config.js', () => ({ getConfig: mockGetConfig }));

import {
  getAdapter,
  bestQuote,
  getChainAdapter,
  listChainNetworks,
} from '../../src/services/routing.service.js';

function fakeQuote(exchange, cryptoAmount, feeFiat) {
  return {
    exchange,
    fiatCurrency: 'USD',
    fiatAmount: 100,
    cryptoAmount: String(cryptoAmount),
    cryptoAsset: 'USDC',
    feeFiat,
    expiresAt: Math.floor(Date.now() / 1000) + 60,
    quoteId: `${exchange}_q1`,
  };
}

const INPUT = { fiatCurrency: 'USD', fiatAmount: 100, cryptoAsset: 'USDC' };

describe('routing.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockReturnValue({ xrpl: undefined });
  });

  describe('getAdapter', () => {
    it('returns the moonpay adapter by name', () => {
      expect(getAdapter('moonpay')).toBe(mockAdapters.moonpay);
    });

    it('returns the coinbase adapter by name', () => {
      expect(getAdapter('coinbase')).toBe(mockAdapters.coinbase);
    });

    it('returns undefined for unknown exchange', () => {
      expect(getAdapter('nonexistent')).toBeUndefined();
    });

    it('returns each registered adapter', () => {
      for (const name of ['moonpay', 'coinbase', 'kraken', 'binance', 'uphold']) {
        expect(getAdapter(name)).toBe(mockAdapters[name]);
      }
    });
  });

  describe('bestQuote', () => {
    it('returns the quote with highest net value (cryptoAmount - feeFiat)', async () => {
      mockAdapters.moonpay.quote.mockResolvedValue(fakeQuote('moonpay', 99, 1.49));
      mockAdapters.coinbase.quote.mockResolvedValue(fakeQuote('coinbase', 99.5, 0.99));
      mockAdapters.kraken.quote.mockResolvedValue(fakeQuote('kraken', 98, 0.5));
      mockAdapters.binance.quote.mockResolvedValue(fakeQuote('binance', 97, 0.1));
      mockAdapters.uphold.quote.mockResolvedValue(fakeQuote('uphold', 98, 1.0));

      const result = await bestQuote(INPUT);
      // coinbase: 99.5 - 0.99 = 98.51 (best)
      expect(result.exchange).toBe('coinbase');
      expect(result.cryptoAmount).toBe('99.5');
    });

    it('ignores adapters that reject and picks from remaining', async () => {
      mockAdapters.moonpay.quote.mockRejectedValue(new Error('upstream down'));
      mockAdapters.coinbase.quote.mockRejectedValue(new Error('timeout'));
      mockAdapters.kraken.quote.mockResolvedValue(fakeQuote('kraken', 95, 0.5));
      mockAdapters.binance.quote.mockResolvedValue(fakeQuote('binance', 96, 2.0));
      mockAdapters.uphold.quote.mockRejectedValue(new Error('not configured'));

      const result = await bestQuote(INPUT);
      // kraken: 95 - 0.5 = 94.5, binance: 96 - 2.0 = 94.0
      expect(result.exchange).toBe('kraken');
    });

    it('throws UpstreamError when all adapters reject', async () => {
      for (const a of Object.values(mockAdapters)) {
        a.quote.mockRejectedValue(new Error('fail'));
      }
      await expect(bestQuote(INPUT)).rejects.toThrow(UpstreamError);
      await expect(bestQuote(INPUT)).rejects.toThrow('Upstream exchange failed');
    });

    it('returns single successful quote when only one adapter succeeds', async () => {
      mockAdapters.moonpay.quote.mockRejectedValue(new Error('fail'));
      mockAdapters.coinbase.quote.mockRejectedValue(new Error('fail'));
      mockAdapters.kraken.quote.mockRejectedValue(new Error('fail'));
      mockAdapters.binance.quote.mockRejectedValue(new Error('fail'));
      mockAdapters.uphold.quote.mockResolvedValue(fakeQuote('uphold', 99, 1.0));

      const result = await bestQuote(INPUT);
      expect(result.exchange).toBe('uphold');
    });

    it('calls all 5 adapters with the input', async () => {
      for (const a of Object.values(mockAdapters)) {
        a.quote.mockResolvedValue(fakeQuote(a.name, 99, 1.0));
      }
      await bestQuote(INPUT);
      for (const a of Object.values(mockAdapters)) {
        expect(a.quote).toHaveBeenCalledWith(INPUT);
      }
    });

    it('handles tie in net value by picking first in reduce order', async () => {
      // All adapters return identical net value
      for (const a of Object.values(mockAdapters)) {
        a.quote.mockResolvedValue(fakeQuote(a.name, 99, 1.0));
      }
      const result = await bestQuote(INPUT);
      // reduce keeps `best` when equal, so first adapter wins
      expect(result).toBeDefined();
      expect(Number(result.cryptoAmount)).toBe(99);
    });

    it('handles zero feeFiat correctly', async () => {
      mockAdapters.moonpay.quote.mockResolvedValue(fakeQuote('moonpay', 100, 0));
      mockAdapters.coinbase.quote.mockResolvedValue(fakeQuote('coinbase', 101, 1.5));
      mockAdapters.kraken.quote.mockRejectedValue(new Error('fail'));
      mockAdapters.binance.quote.mockRejectedValue(new Error('fail'));
      mockAdapters.uphold.quote.mockRejectedValue(new Error('fail'));

      const result = await bestQuote(INPUT);
      // moonpay: 100 - 0 = 100, coinbase: 101 - 1.5 = 99.5
      expect(result.exchange).toBe('moonpay');
    });
  });

  describe('getChainAdapter', () => {
    it('returns xrpl-evm adapter for eip155:1440002', () => {
      const adapter = getChainAdapter('eip155:1440002');
      expect(adapter).toBeDefined();
      expect(adapter.name).toBe('xrpl-evm');
      expect(adapter.caip2).toBe('eip155:1440002');
      expect(adapter.verifyPayment).toBe(mockXrplEvmVerify);
    });

    it('returns base adapter for eip155:8453', () => {
      const adapter = getChainAdapter('eip155:8453');
      expect(adapter).toBeDefined();
      expect(adapter.name).toBe('base');
      expect(adapter.caip2).toBe('eip155:8453');
      expect(adapter.verifyPayment).toBe(mockBaseVerify);
    });

    it('returns undefined for unregistered network', () => {
      expect(getChainAdapter('eip155:1')).toBeUndefined();
    });

    it('returns undefined for unregistered CAIP-2 namespace', () => {
      expect(getChainAdapter('cosmos:cosmoshub-4')).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      expect(getChainAdapter('')).toBeUndefined();
    });

    it('delegates verifyPayment to the underlying adapter function', async () => {
      mockBaseVerify.mockResolvedValueOnce({ ok: true, blockNumber: 42 });
      const adapter = getChainAdapter('eip155:8453');
      const result = await adapter.verifyPayment({
        txHash: '0x' + 'ab'.repeat(32),
        expectedTo: '0x' + '11'.repeat(20),
        expectedAmountWei: BigInt(5000000),
        minConfirmations: 2,
      });
      expect(result).toEqual({ ok: true, blockNumber: 42 });
      expect(mockBaseVerify).toHaveBeenCalledOnce();
    });

    it('delegates xrpl-evm verifyPayment to the underlying adapter function', async () => {
      mockXrplEvmVerify.mockResolvedValueOnce({ ok: false, reason: 'tx-reverted' });
      const adapter = getChainAdapter('eip155:1440002');
      const result = await adapter.verifyPayment({
        txHash: '0x' + 'cd'.repeat(32),
        expectedTo: '0x' + '22'.repeat(20),
        expectedAmountWei: BigInt(1000000),
        minConfirmations: 12,
      });
      expect(result).toEqual({ ok: false, reason: 'tx-reverted' });
      expect(mockXrplEvmVerify).toHaveBeenCalledOnce();
    });
  });

  describe('listChainNetworks', () => {
    it('returns all registered CAIP-2 network identifiers', () => {
      const networks = listChainNetworks();
      expect(networks).toContain('eip155:1440002');
      expect(networks).toContain('eip155:8453');
      expect(networks).toContain('eip155:84532');
      expect(networks).toContain('xrpl:0');
      expect(networks).toContain('xrpl:1');
      expect(networks).toContain('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
      expect(networks).toContain('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1');
      expect(networks).toHaveLength(7);
    });

    it('returns an array', () => {
      expect(Array.isArray(listChainNetworks())).toBe(true);
    });
  });

  describe('getChainAdapter — native XRPL', () => {
    it('returns xrpl-mainnet adapter for xrpl:0', () => {
      const adapter = getChainAdapter('xrpl:0');
      expect(adapter).toBeDefined();
      expect(adapter.name).toBe('xrpl-mainnet');
      expect(adapter.caip2).toBe('xrpl:0');
    });

    it('returns xrpl-testnet adapter for xrpl:1', () => {
      const adapter = getChainAdapter('xrpl:1');
      expect(adapter).toBeDefined();
      expect(adapter.name).toBe('xrpl-testnet');
      expect(adapter.caip2).toBe('xrpl:1');
    });

    it('delegates xrpl:0 verifyPayment to native XRPL adapter with drops amount', async () => {
      mockNativeXrplVerify.mockResolvedValueOnce({ ok: true, ledgerIndex: 100 });
      const adapter = getChainAdapter('xrpl:0');
      const result = await adapter.verifyPayment({
        txHash: 'AB' + 'CD'.repeat(31),
        expectedTo: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
        expectedAmountWei: BigInt(5000000),
        minConfirmations: 2,
      });
      expect(result).toEqual({ ok: true, ledgerIndex: 100 });
      expect(mockNativeXrplVerify).toHaveBeenCalledWith({
        txHash: 'AB' + 'CD'.repeat(31),
        destination: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
        allowed: ['5000000'],
      });
    });

    it('strips 0x prefix from tx hash before passing to XRPL adapter', async () => {
      mockNativeXrplVerify.mockResolvedValueOnce({ ok: true, ledgerIndex: 200 });
      const adapter = getChainAdapter('xrpl:1');
      const hexHash = '0x' + 'ab'.repeat(32);
      await adapter.verifyPayment({
        txHash: hexHash,
        expectedTo: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
        expectedAmountWei: BigInt(1000000),
        minConfirmations: 2,
      });
      expect(mockNativeXrplVerify).toHaveBeenCalledWith(
        expect.objectContaining({ txHash: 'ab'.repeat(32) }),
      );
    });

    it('passes IOU amount object when issuer matches configured usdcIssuer', async () => {
      const issuer = 'rcEGREd8NmkKRE8GE424sksyt1tJVFZwu';
      mockGetConfig.mockReturnValue({ xrpl: { usdcIssuer: issuer } });
      mockNativeXrplVerify.mockResolvedValueOnce({ ok: true, ledgerIndex: 300 });
      const adapter = getChainAdapter('xrpl:0');
      await adapter.verifyPayment({
        txHash: 'FF'.repeat(32),
        expectedTo: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
        expectedAmountWei: BigInt(5000000),
        minConfirmations: 2,
        issuer,
      });
      expect(mockNativeXrplVerify).toHaveBeenCalledWith({
        txHash: 'FF'.repeat(32),
        destination: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
        amount: { currency: 'USD', issuer, value: '5' },
        issuer,
      });
    });

    it('formats IOU fractional value correctly', async () => {
      const issuer = 'rcEGREd8NmkKRE8GE424sksyt1tJVFZwu';
      mockGetConfig.mockReturnValue({ xrpl: { usdcIssuer: issuer } });
      mockNativeXrplVerify.mockResolvedValueOnce({ ok: true, ledgerIndex: 400 });
      const adapter = getChainAdapter('xrpl:0');
      await adapter.verifyPayment({
        txHash: 'AA'.repeat(32),
        expectedTo: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
        expectedAmountWei: BigInt(5500),
        minConfirmations: 2,
        issuer,
      });
      expect(mockNativeXrplVerify).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: { currency: 'USD', issuer, value: '0.005500' },
        }),
      );
    });

    it('returns failure result from underlying adapter', async () => {
      mockNativeXrplVerify.mockResolvedValueOnce({ ok: false, reason: 'wrong-destination' });
      const adapter = getChainAdapter('xrpl:0');
      const result = await adapter.verifyPayment({
        txHash: 'BB'.repeat(32),
        expectedTo: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
        expectedAmountWei: BigInt(1000000),
        minConfirmations: 2,
      });
      expect(result).toEqual({ ok: false, reason: 'wrong-destination' });
    });

    it('does not affect existing Base/XRPL-EVM adapters', () => {
      const base = getChainAdapter('eip155:8453');
      expect(base.name).toBe('base');
      expect(base.verifyPayment).toBe(mockBaseVerify);

      const xrplEvm = getChainAdapter('eip155:1440002');
      expect(xrplEvm.name).toBe('xrpl-evm');
      expect(xrplEvm.verifyPayment).toBe(mockXrplEvmVerify);
    });

    it('returns undefined for unregistered xrpl reference', () => {
      expect(getChainAdapter('xrpl:2')).toBeUndefined();
    });
  });

  describe('getChainAdapter — Solana', () => {
    it('returns solana-mainnet adapter for canonical CAIP-2', () => {
      const adapter = getChainAdapter('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
      expect(adapter).toBeDefined();
      expect(adapter.name).toBe('solana-mainnet');
      expect(adapter.caip2).toBe('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
      expect(typeof adapter.verifyPayment).toBe('function');
    });

    it('returns solana-devnet adapter for devnet CAIP-2', () => {
      const adapter = getChainAdapter('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1');
      expect(adapter).toBeDefined();
      expect(adapter.name).toBe('solana-devnet');
      expect(adapter.caip2).toBe('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1');
    });

    it('returns undefined for unregistered solana reference', () => {
      expect(getChainAdapter('solana:UnknownReference12345')).toBeUndefined();
    });
  });

  describe('wrapXrplVerify — multi-issuer allowed list', () => {
    const USDC_ISSUER = 'rcEGREd8NmkKRE8GE424sksyt1tJVFZwu';
    const RLUSD_ISSUER = 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De';
    const DEST = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';
    const TX = 'AB'.repeat(32);

    it('passes USDC + RLUSD allowed list when both issuers configured', async () => {
      mockGetConfig.mockReturnValue({
        xrpl: { payTo: DEST, usdcIssuer: USDC_ISSUER, rlusdIssuer: RLUSD_ISSUER },
      });
      mockNativeXrplVerify.mockResolvedValueOnce({ ok: true, ledgerIndex: 1 });
      const adapter = getChainAdapter('xrpl:0');

      await adapter.verifyPayment({
        txHash: TX,
        expectedTo: DEST,
        expectedAmountWei: BigInt(5000),
        minConfirmations: 2,
      });

      expect(mockNativeXrplVerify).toHaveBeenCalledWith({
        txHash: TX,
        destination: DEST,
        allowed: [
          '5000',
          { currency: 'USD', issuer: USDC_ISSUER, value: '0.005000' },
          { currency: 'RLUSD', issuer: RLUSD_ISSUER, value: '0.005000' },
        ],
      });
    });

    it('passes USDC-only allowed list when only usdcIssuer configured', async () => {
      mockGetConfig.mockReturnValue({ xrpl: { payTo: DEST, usdcIssuer: USDC_ISSUER } });
      mockNativeXrplVerify.mockResolvedValueOnce({ ok: true, ledgerIndex: 2 });
      const adapter = getChainAdapter('xrpl:0');

      await adapter.verifyPayment({
        txHash: TX,
        expectedTo: DEST,
        expectedAmountWei: BigInt(5000),
        minConfirmations: 2,
      });

      expect(mockNativeXrplVerify).toHaveBeenCalledWith({
        txHash: TX,
        destination: DEST,
        allowed: ['5000', { currency: 'USD', issuer: USDC_ISSUER, value: '0.005000' }],
      });
    });

    it('passes RLUSD-only allowed list when only rlusdIssuer configured', async () => {
      mockGetConfig.mockReturnValue({ xrpl: { payTo: DEST, rlusdIssuer: RLUSD_ISSUER } });
      mockNativeXrplVerify.mockResolvedValueOnce({ ok: true, ledgerIndex: 3 });
      const adapter = getChainAdapter('xrpl:0');

      await adapter.verifyPayment({
        txHash: TX,
        expectedTo: DEST,
        expectedAmountWei: BigInt(5000),
        minConfirmations: 2,
      });

      expect(mockNativeXrplVerify).toHaveBeenCalledWith({
        txHash: TX,
        destination: DEST,
        allowed: ['5000', { currency: 'RLUSD', issuer: RLUSD_ISSUER, value: '0.005000' }],
      });
    });

    it('explicit input.issuer matching config.usdcIssuer routes to USD currency', async () => {
      mockGetConfig.mockReturnValue({
        xrpl: { payTo: DEST, usdcIssuer: USDC_ISSUER, rlusdIssuer: RLUSD_ISSUER },
      });
      mockNativeXrplVerify.mockResolvedValueOnce({ ok: true, ledgerIndex: 4 });
      const adapter = getChainAdapter('xrpl:0');

      await adapter.verifyPayment({
        txHash: TX,
        expectedTo: DEST,
        expectedAmountWei: BigInt(5000),
        minConfirmations: 2,
        issuer: USDC_ISSUER,
      });

      expect(mockNativeXrplVerify).toHaveBeenCalledWith({
        txHash: TX,
        destination: DEST,
        amount: { currency: 'USD', issuer: USDC_ISSUER, value: '0.005000' },
        issuer: USDC_ISSUER,
      });
    });

    it('explicit input.issuer matching config.rlusdIssuer routes to RLUSD currency', async () => {
      mockGetConfig.mockReturnValue({
        xrpl: { payTo: DEST, usdcIssuer: USDC_ISSUER, rlusdIssuer: RLUSD_ISSUER },
      });
      mockNativeXrplVerify.mockResolvedValueOnce({ ok: true, ledgerIndex: 6 });
      const adapter = getChainAdapter('xrpl:0');

      await adapter.verifyPayment({
        txHash: TX,
        expectedTo: DEST,
        expectedAmountWei: BigInt(5000),
        minConfirmations: 2,
        issuer: RLUSD_ISSUER,
      });

      expect(mockNativeXrplVerify).toHaveBeenCalledWith({
        txHash: TX,
        destination: DEST,
        amount: { currency: 'RLUSD', issuer: RLUSD_ISSUER, value: '0.005000' },
        issuer: RLUSD_ISSUER,
      });
    });

    it('rejects forged issuer not matching any configured issuer', async () => {
      mockGetConfig.mockReturnValue({
        xrpl: { payTo: DEST, usdcIssuer: USDC_ISSUER, rlusdIssuer: RLUSD_ISSUER },
      });
      const adapter = getChainAdapter('xrpl:0');
      const forgedIssuer = 'rFORGED00000000000000000000000000';

      const result = await adapter.verifyPayment({
        txHash: TX,
        expectedTo: DEST,
        expectedAmountWei: BigInt(5000),
        minConfirmations: 2,
        issuer: forgedIssuer,
      });

      expect(result).toEqual({ ok: false, reason: 'forged-issuer' });
      expect(mockNativeXrplVerify).not.toHaveBeenCalled();
    });

    it('rejects issuer when no xrpl config is present', async () => {
      mockGetConfig.mockReturnValue({ xrpl: undefined });
      const adapter = getChainAdapter('xrpl:0');

      const result = await adapter.verifyPayment({
        txHash: TX,
        expectedTo: DEST,
        expectedAmountWei: BigInt(5000),
        minConfirmations: 2,
        issuer: USDC_ISSUER,
      });

      expect(result).toEqual({ ok: false, reason: 'forged-issuer' });
      expect(mockNativeXrplVerify).not.toHaveBeenCalled();
    });

    it('falls back to drops when config unavailable (getConfig throws)', async () => {
      mockGetConfig.mockImplementation(() => {
        throw new Error('config not loaded');
      });
      mockNativeXrplVerify.mockResolvedValueOnce({ ok: true, ledgerIndex: 5 });
      const adapter = getChainAdapter('xrpl:0');

      await adapter.verifyPayment({
        txHash: TX,
        expectedTo: DEST,
        expectedAmountWei: BigInt(1000000),
        minConfirmations: 2,
      });

      expect(mockNativeXrplVerify).toHaveBeenCalledWith({
        txHash: TX,
        destination: DEST,
        allowed: ['1000000'],
      });
    });
  });
});

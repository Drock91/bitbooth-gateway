import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UpstreamError } from '../../src/lib/errors.js';

const { mockXrplEvmVerify, mockBaseVerify, mockNativeXrplVerify, mockGetConfig } = vi.hoisted(
  () => ({
    mockXrplEvmVerify: vi.fn(),
    mockBaseVerify: vi.fn(),
    mockNativeXrplVerify: vi.fn(),
    mockGetConfig: vi.fn(() => ({ xrpl: undefined })),
  }),
);

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

describe('routing.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockReturnValue({ xrpl: undefined });
  });

  describe('getAdapter', () => {
    it('returns undefined for any name (registry is empty after stub deletion)', () => {
      expect(getAdapter('moonpay')).toBeUndefined();
      expect(getAdapter('nonexistent')).toBeUndefined();
    });
  });

  describe('bestQuote', () => {
    it('throws UpstreamError when registry is empty', async () => {
      await expect(
        bestQuote({ fiatCurrency: 'USD', fiatAmount: 100, cryptoAsset: 'USDC' }),
      ).rejects.toThrow(UpstreamError);
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

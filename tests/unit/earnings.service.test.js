import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockScanAllConfirmed = vi.hoisted(() => vi.fn());

vi.mock('../../src/repositories/payments.repo.js', () => ({
  paymentsRepo: { scanAllConfirmed: mockScanAllConfirmed },
}));

import { earningsService, CHAIN_META } from '../../src/services/earnings.service.js';

function fakePayment(overrides = {}) {
  return {
    idempotencyKey: 'idem-' + Math.random().toString(36).slice(2),
    accountId: 'acct-1',
    amountWei: '5000',
    assetSymbol: 'USDC',
    txHash: '0xabc123',
    network: 'eip155:84532',
    resource: '/v1/fetch',
    status: 'confirmed',
    createdAt: new Date().toISOString(),
    confirmedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('CHAIN_META', () => {
  it('marks Base Sepolia as testnet', () => {
    expect(CHAIN_META['eip155:84532'].isTestnet).toBe(true);
  });

  it('marks Base Mainnet as not testnet', () => {
    expect(CHAIN_META['eip155:8453'].isTestnet).toBe(false);
  });

  it('marks XRPL EVM as testnet', () => {
    expect(CHAIN_META['eip155:1440002'].isTestnet).toBe(true);
  });

  it('marks XRPL Mainnet as not testnet', () => {
    expect(CHAIN_META['xrpl:0'].isTestnet).toBe(false);
  });

  it('marks XRPL Testnet as testnet', () => {
    expect(CHAIN_META['xrpl:1'].isTestnet).toBe(true);
  });

  it('marks Solana mainnet as not testnet', () => {
    expect(CHAIN_META['solana:mainnet'].isTestnet).toBe(false);
  });

  it('marks Solana devnet as testnet', () => {
    expect(CHAIN_META['solana:devnet'].isTestnet).toBe(true);
  });

  it('marks unknown as not testnet', () => {
    expect(CHAIN_META.unknown.isTestnet).toBe(false);
  });
});

describe('earningsService.summary', () => {
  beforeEach(() => vi.clearAllMocks());

  const testnetPayment = fakePayment({ network: 'eip155:84532', amountWei: '1000000' });
  const mainnetPayment = fakePayment({ network: 'eip155:8453', amountWei: '2000000' });
  const xrplMainnet = fakePayment({ network: 'xrpl:0', amountWei: '3000000', assetSymbol: 'XRP' });
  const xrplTestnet = fakePayment({ network: 'xrpl:1', amountWei: '500000', assetSymbol: 'XRP' });

  it('defaults to mode=real, filtering out testnet payments', async () => {
    mockScanAllConfirmed.mockResolvedValue([testnetPayment, mainnetPayment, xrplMainnet, xrplTestnet]);
    const result = await earningsService.summary();
    expect(result.mode).toBe('real');
    expect(result.totals.payments).toBe(2);
    const networks = result.byChain.map(c => c.network);
    expect(networks).toContain('eip155:8453');
    expect(networks).toContain('xrpl:0');
    expect(networks).not.toContain('eip155:84532');
    expect(networks).not.toContain('xrpl:1');
  });

  it('mode=testnet returns only testnet payments', async () => {
    mockScanAllConfirmed.mockResolvedValue([testnetPayment, mainnetPayment, xrplMainnet, xrplTestnet]);
    const result = await earningsService.summary({ mode: 'testnet' });
    expect(result.mode).toBe('testnet');
    expect(result.totals.payments).toBe(2);
    const networks = result.byChain.map(c => c.network);
    expect(networks).toContain('eip155:84532');
    expect(networks).toContain('xrpl:1');
    expect(networks).not.toContain('eip155:8453');
  });

  it('mode=all returns all payments', async () => {
    mockScanAllConfirmed.mockResolvedValue([testnetPayment, mainnetPayment, xrplMainnet, xrplTestnet]);
    const result = await earningsService.summary({ mode: 'all' });
    expect(result.mode).toBe('all');
    expect(result.totals.payments).toBe(4);
    expect(result.byChain).toHaveLength(4);
  });

  it('includes isTestnet flag in byChain entries', async () => {
    mockScanAllConfirmed.mockResolvedValue([testnetPayment, mainnetPayment]);
    const result = await earningsService.summary({ mode: 'all' });
    const sepolia = result.byChain.find(c => c.network === 'eip155:84532');
    const base = result.byChain.find(c => c.network === 'eip155:8453');
    expect(sepolia.isTestnet).toBe(true);
    expect(base.isTestnet).toBe(false);
  });

  it('includes isTestnet flag in recent payments', async () => {
    mockScanAllConfirmed.mockResolvedValue([testnetPayment, mainnetPayment]);
    const result = await earningsService.summary({ mode: 'all' });
    const sepoliaRecent = result.recent.find(r => r.network === 'eip155:84532');
    const baseRecent = result.recent.find(r => r.network === 'eip155:8453');
    expect(sepoliaRecent.isTestnet).toBe(true);
    expect(baseRecent.isTestnet).toBe(false);
  });

  it('returns empty results when mode filters out all payments', async () => {
    mockScanAllConfirmed.mockResolvedValue([testnetPayment]);
    const result = await earningsService.summary({ mode: 'real' });
    expect(result.totals.payments).toBe(0);
    expect(result.byChain).toHaveLength(0);
    expect(result.recent).toHaveLength(0);
  });

  it('returns mode in the response', async () => {
    mockScanAllConfirmed.mockResolvedValue([]);
    const result = await earningsService.summary({ mode: 'testnet' });
    expect(result.mode).toBe('testnet');
  });

  it('handles empty opts gracefully', async () => {
    mockScanAllConfirmed.mockResolvedValue([mainnetPayment]);
    const result = await earningsService.summary();
    expect(result.mode).toBe('real');
    expect(result.totals.payments).toBe(1);
  });

  it('filters legacy payments (no network field) correctly in real mode', async () => {
    const legacy = fakePayment({ network: undefined, assetSymbol: 'USDC', txHash: '0xdeadbeef' });
    mockScanAllConfirmed.mockResolvedValue([legacy]);
    // Legacy EVM defaults to eip155:84532 (testnet), so real mode filters it out
    const result = await earningsService.summary({ mode: 'real' });
    expect(result.totals.payments).toBe(0);
  });

  it('includes legacy XRPL payments in real mode', async () => {
    const legacyXrpl = fakePayment({
      network: undefined,
      assetSymbol: 'XRP',
      txHash: 'ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890',
    });
    mockScanAllConfirmed.mockResolvedValue([legacyXrpl]);
    // Legacy XRPL inferred as xrpl:0 (mainnet), so real mode includes it
    const result = await earningsService.summary({ mode: 'real' });
    expect(result.totals.payments).toBe(1);
    expect(result.byChain[0].network).toBe('xrpl:0');
  });

  it('preserves time-windowed totals with mode filtering', async () => {
    const recentMainnet = fakePayment({
      network: 'eip155:8453',
      amountWei: '5000000',
      confirmedAt: new Date().toISOString(),
    });
    const oldTestnet = fakePayment({
      network: 'eip155:84532',
      amountWei: '9000000',
      confirmedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    });
    mockScanAllConfirmed.mockResolvedValue([recentMainnet, oldTestnet]);
    const result = await earningsService.summary({ mode: 'real' });
    expect(result.totals.payments).toBe(1);
    expect(result.totals.last24h).toBeGreaterThan(0);
  });

  it('still returns sparkline with 24 buckets', async () => {
    mockScanAllConfirmed.mockResolvedValue([mainnetPayment]);
    const result = await earningsService.summary({ mode: 'real' });
    expect(result.sparkline).toHaveLength(24);
  });
});

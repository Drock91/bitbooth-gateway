import { describe, it, expect, vi, beforeEach } from 'vitest';

const MOCK_NONCE = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
const MOCK_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const MOCK_TX_HASH = '0x' + 'ab'.repeat(32);
const MOCK_CHAIN_ID = 8453;
const MOCK_WINDOW = 120;
const MOCK_CONFIRMATIONS = 2;
const MOCK_USDC_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const MOCK_SOLANA_CONFIG = {
  network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  payTo: 'So1anaWa11etAddr3ss111111111111111111111111',
  usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
};

const MOCK_XRPL_CONFIG = {
  payTo: 'rU6K7V3Po4snVhBBaU29sesqs2qTQJWDw1',
  usdcIssuer: 'rN7n7otQDd6FczFgLdSsqXaVCXoWk7V7jZ',
};

function makeConfig(solana, xrpl, stage = 'staging') {
  return {
    stage,
    chain: {
      chainId: MOCK_CHAIN_ID,
      requiredConfirmations: MOCK_CONFIRMATIONS,
      usdcContract: MOCK_USDC_CONTRACT,
    },
    x402: { paymentWindowSeconds: MOCK_WINDOW },
    solana,
    xrpl,
  };
}

const {
  mockNewNonce,
  mockGetConfig,
  mockVerifyPayment,
  mockGetAgentAddress,
  mockGetByNonce,
  mockRecordConfirmed,
  mockUsageIncrement,
  mockCheckPrePayment,
  mockTrackNonceFailure,
  mockGetChainAdapter,
} = vi.hoisted(() => ({
  mockNewNonce: vi.fn(() => MOCK_NONCE),
  mockGetConfig: vi.fn(() => makeConfig(undefined)),
  mockVerifyPayment: vi.fn(),
  mockGetAgentAddress: vi.fn(() => Promise.resolve(MOCK_ADDRESS)),
  mockGetByNonce: vi.fn(),
  mockRecordConfirmed: vi.fn(() => Promise.resolve()),
  mockUsageIncrement: vi.fn(() => Promise.resolve()),
  mockCheckPrePayment: vi.fn(() => Promise.resolve()),
  mockTrackNonceFailure: vi.fn(() => Promise.resolve()),
  mockGetChainAdapter: vi.fn(),
}));

vi.mock('../../src/lib/crypto.js', () => ({ newNonce: mockNewNonce }));
vi.mock('../../src/lib/config.js', () => ({ getConfig: mockGetConfig }));
vi.mock('../../src/adapters/xrpl-evm/index.js', () => ({
  getAgentAddress: mockGetAgentAddress,
}));
vi.mock('../../src/services/routing.service.js', () => ({
  getChainAdapter: mockGetChainAdapter,
}));
vi.mock('../../src/repositories/payments.repo.js', () => ({
  paymentsRepo: { getByNonce: mockGetByNonce, recordConfirmed: mockRecordConfirmed },
}));
vi.mock('../../src/repositories/usage.repo.js', () => ({
  usageRepo: { increment: mockUsageIncrement },
}));
vi.mock('../../src/services/fraud.service.js', () => ({
  fraudService: { checkPrePayment: mockCheckPrePayment, trackNonceFailure: mockTrackNonceFailure },
}));

import { enforceX402, resolvePayToForNetwork } from '../../src/middleware/x402.middleware.js';
import { PaymentRequiredError, ValidationError } from '../../src/lib/errors.js';

function makeRoute(overrides = {}) {
  return {
    amountWei: '5000000',
    assetSymbol: 'USDC',
    resource: '/v1/data',
    ...overrides,
  };
}

function validHeader(overrides = {}) {
  return JSON.stringify({
    nonce: 'a'.repeat(16),
    txHash: MOCK_TX_HASH,
    signature: 'sig123',
    ...overrides,
  });
}

function makeInput(headerValue, headerKey = 'x-payment') {
  return {
    headers: headerValue != null ? { [headerKey]: headerValue } : {},
    route: makeRoute(),
    accountId: 'acct-1',
  };
}

describe('x402.middleware — enforceX402', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockReturnValue(makeConfig(undefined));
    mockGetChainAdapter.mockImplementation((network) => {
      if (network === `eip155:${MOCK_CHAIN_ID}` || network === 'eip155:1440002') {
        return { name: 'mock-chain', caip2: network, verifyPayment: mockVerifyPayment };
      }
      return undefined;
    });
  });

  // --- no header ---

  it('throws PaymentRequiredError when x-payment header is missing', async () => {
    const input = makeInput(null);
    await expect(enforceX402(input)).rejects.toThrow(PaymentRequiredError);
  });

  it('includes accepts array with Base entry when header missing', async () => {
    const input = makeInput(null);
    try {
      await enforceX402(input);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PaymentRequiredError);
      const c = e.challenge;
      expect(c.nonce).toBe(MOCK_NONCE);
      expect(c.accepts).toHaveLength(1);
      expect(c.accepts[0]).toEqual({
        scheme: 'exact',
        network: `eip155:${MOCK_CHAIN_ID}`,
        payTo: MOCK_ADDRESS,
        asset: `USDC@${MOCK_USDC_CONTRACT}`,
        amount: '5000000',
      });
      expect(c.expiresAt).toBeTypeOf('number');
      expect(c.resource).toBe('/v1/data');
    }
  });

  it('includes legacy fields (payTo, chainId, amountWei) for backwards compat', async () => {
    const input = makeInput(null);
    try {
      await enforceX402(input);
      expect.unreachable();
    } catch (e) {
      const c = e.challenge;
      expect(c.payTo).toBe(MOCK_ADDRESS);
      expect(c.chainId).toBe(MOCK_CHAIN_ID);
      expect(c.amountWei).toBe('5000000');
      expect(c.assetSymbol).toBe('USDC');
    }
  });

  it('includes Solana entry in accepts when solana is configured', async () => {
    mockGetConfig.mockReturnValue(makeConfig(MOCK_SOLANA_CONFIG));
    const input = makeInput(null);
    try {
      await enforceX402(input);
      expect.unreachable();
    } catch (e) {
      const c = e.challenge;
      expect(c.accepts).toHaveLength(2);
      expect(c.accepts[1]).toEqual({
        scheme: 'exact',
        network: MOCK_SOLANA_CONFIG.network,
        payTo: MOCK_SOLANA_CONFIG.payTo,
        asset: `USDC@${MOCK_SOLANA_CONFIG.usdcMint}`,
        amount: '5000000',
      });
    }
  });

  it('includes XRP + USDC XRPL entries when xrpl is configured with usdcIssuer', async () => {
    mockGetConfig.mockReturnValue(makeConfig(undefined, MOCK_XRPL_CONFIG, 'staging'));
    const input = makeInput(null);
    try {
      await enforceX402(input);
      expect.unreachable();
    } catch (e) {
      const c = e.challenge;
      expect(c.accepts).toHaveLength(3);
      expect(c.accepts[1]).toEqual({
        scheme: 'exact',
        network: 'xrpl:1',
        payTo: MOCK_XRPL_CONFIG.payTo,
        asset: 'XRP',
        amount: '5000000',
      });
      expect(c.accepts[2]).toEqual({
        scheme: 'exact',
        network: 'xrpl:1',
        payTo: MOCK_XRPL_CONFIG.payTo,
        asset: `USDC@${MOCK_XRPL_CONFIG.usdcIssuer}`,
        amount: '5000000',
      });
    }
  });

  it('uses xrpl:0 for prod stage', async () => {
    mockGetConfig.mockReturnValue(makeConfig(undefined, MOCK_XRPL_CONFIG, 'prod'));
    const input = makeInput(null);
    try {
      await enforceX402(input);
      expect.unreachable();
    } catch (e) {
      const xrplEntry = e.challenge.accepts.find((a) => a.network.startsWith('xrpl:'));
      expect(xrplEntry.network).toBe('xrpl:0');
    }
  });

  it('emits only native XRP entry when no stablecoin issuers configured', async () => {
    mockGetConfig.mockReturnValue(makeConfig(undefined, { payTo: MOCK_XRPL_CONFIG.payTo }));
    const input = makeInput(null);
    try {
      await enforceX402(input);
      expect.unreachable();
    } catch (e) {
      const xrplEntries = e.challenge.accepts.filter((a) => a.network.startsWith('xrpl:'));
      expect(xrplEntries).toHaveLength(1);
      expect(xrplEntries[0].asset).toBe('XRP');
    }
  });

  it('includes Base + Solana + XRP + USDC XRPL rails when solana + xrpl are configured', async () => {
    mockGetConfig.mockReturnValue(makeConfig(MOCK_SOLANA_CONFIG, MOCK_XRPL_CONFIG));
    const input = makeInput(null);
    try {
      await enforceX402(input);
      expect.unreachable();
    } catch (e) {
      const c = e.challenge;
      expect(c.accepts).toHaveLength(4);
      expect(c.accepts[0].network).toBe(`eip155:${MOCK_CHAIN_ID}`);
      expect(c.accepts[1].network).toBe(MOCK_SOLANA_CONFIG.network);
      expect(c.accepts[2].network).toBe('xrpl:1');
      expect(c.accepts[2].asset).toBe('XRP');
      expect(c.accepts[3].network).toBe('xrpl:1');
      expect(c.accepts[3].asset).toBe(`USDC@${MOCK_XRPL_CONFIG.usdcIssuer}`);
    }
  });

  it('includes XRP + USDC + RLUSD entries when both stablecoin issuers configured', async () => {
    const RLUSD_ISSUER = 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De';
    mockGetConfig.mockReturnValue(
      makeConfig(undefined, { ...MOCK_XRPL_CONFIG, rlusdIssuer: RLUSD_ISSUER }, 'staging'),
    );
    const input = makeInput(null);
    try {
      await enforceX402(input);
      expect.unreachable();
    } catch (e) {
      const xrplEntries = e.challenge.accepts.filter((a) => a.network.startsWith('xrpl:'));
      expect(xrplEntries).toHaveLength(3);
      expect(xrplEntries[0].asset).toBe('XRP');
      expect(xrplEntries[1].asset).toBe(`USDC@${MOCK_XRPL_CONFIG.usdcIssuer}`);
      expect(xrplEntries[2].asset).toBe(`RLUSD@${RLUSD_ISSUER}`);
      expect(xrplEntries.every((e) => e.network === 'xrpl:1')).toBe(true);
      expect(xrplEntries.every((e) => e.payTo === MOCK_XRPL_CONFIG.payTo)).toBe(true);
    }
  });

  it('includes XRP + RLUSD when only rlusdIssuer configured', async () => {
    const RLUSD_ISSUER = 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De';
    mockGetConfig.mockReturnValue(
      makeConfig(
        undefined,
        { payTo: MOCK_XRPL_CONFIG.payTo, rlusdIssuer: RLUSD_ISSUER },
        'staging',
      ),
    );
    const input = makeInput(null);
    try {
      await enforceX402(input);
      expect.unreachable();
    } catch (e) {
      const xrplEntries = e.challenge.accepts.filter((a) => a.network.startsWith('xrpl:'));
      expect(xrplEntries).toHaveLength(2);
      expect(xrplEntries[0].asset).toBe('XRP');
      expect(xrplEntries[1].asset).toBe(`RLUSD@${RLUSD_ISSUER}`);
    }
  });

  it('XRP native entry has no issuer suffix in asset field', async () => {
    mockGetConfig.mockReturnValue(makeConfig(undefined, MOCK_XRPL_CONFIG, 'prod'));
    const input = makeInput(null);
    try {
      await enforceX402(input);
      expect.unreachable();
    } catch (e) {
      const xrpEntry = e.challenge.accepts.find((a) => a.asset === 'XRP');
      expect(xrpEntry).toBeDefined();
      expect(xrpEntry.asset).not.toContain('@');
      expect(xrpEntry.network).toBe('xrpl:0');
    }
  });

  it('omits XRPL from accepts when xrpl config is absent', async () => {
    mockGetConfig.mockReturnValue(makeConfig(undefined, undefined));
    const input = makeInput(null);
    try {
      await enforceX402(input);
      expect.unreachable();
    } catch (e) {
      expect(e.challenge.accepts).toHaveLength(1);
      const networks = e.challenge.accepts.map((a) => a.network);
      expect(networks).not.toContain(expect.stringMatching(/^xrpl:/));
    }
  });

  it('reads X-PAYMENT (uppercase) when lowercase key absent', async () => {
    const input = {
      headers: { 'X-PAYMENT': validHeader() },
      route: makeRoute(),
      accountId: 'acct-1',
    };
    mockGetByNonce.mockResolvedValueOnce(null);
    mockVerifyPayment.mockResolvedValueOnce({ ok: true, blockNumber: 42 });

    const result = await enforceX402(input);
    expect(result.paid).toBe(true);
  });

  // --- invalid header ---

  it('throws ValidationError when header is not valid JSON', async () => {
    const input = makeInput('not-json');
    await expect(enforceX402(input)).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when header JSON fails Zod schema', async () => {
    const input = makeInput(JSON.stringify({ nonce: 'short', txHash: 'bad', signature: '' }));
    await expect(enforceX402(input)).rejects.toThrow(ValidationError);
  });

  it('ValidationError details include header field name', async () => {
    const input = makeInput('{{bad');
    try {
      await enforceX402(input);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect(e.details.header).toBe('X-PAYMENT');
    }
  });

  // --- nonce reuse ---

  it('throws PaymentRequiredError when nonce was already seen', async () => {
    mockGetByNonce.mockResolvedValueOnce({ txHash: MOCK_TX_HASH });

    const input = makeInput(validHeader());
    await expect(enforceX402(input)).rejects.toThrow(PaymentRequiredError);
    expect(mockGetByNonce).toHaveBeenCalledWith('a'.repeat(16));
  });

  it('returns a fresh challenge on nonce reuse (not the old data)', async () => {
    mockGetByNonce.mockResolvedValueOnce({ txHash: MOCK_TX_HASH });

    const input = makeInput(validHeader());
    try {
      await enforceX402(input);
      expect.unreachable();
    } catch (e) {
      expect(e.challenge.nonce).toBe(MOCK_NONCE);
    }
  });

  // --- verification failure ---

  it('throws PaymentRequiredError when verifyPayment returns ok:false', async () => {
    mockGetByNonce.mockResolvedValueOnce(null);
    mockVerifyPayment.mockResolvedValueOnce({ ok: false, reason: 'insufficient confirmations' });

    const input = makeInput(validHeader());
    await expect(enforceX402(input)).rejects.toThrow(PaymentRequiredError);
  });

  it('includes reason from verifyPayment in the challenge on failure', async () => {
    mockGetByNonce.mockResolvedValueOnce(null);
    mockVerifyPayment.mockResolvedValueOnce({ ok: false, reason: 'wrong recipient' });

    const input = makeInput(validHeader());
    try {
      await enforceX402(input);
      expect.unreachable();
    } catch (e) {
      expect(e.challenge.reason).toBe('wrong recipient');
    }
  });

  it('passes correct params to verifyPayment', async () => {
    mockGetByNonce.mockResolvedValueOnce(null);
    mockVerifyPayment.mockResolvedValueOnce({ ok: true, blockNumber: 10 });

    const input = makeInput(validHeader());
    await enforceX402(input);

    expect(mockVerifyPayment).toHaveBeenCalledWith({
      txHash: MOCK_TX_HASH,
      expectedTo: MOCK_ADDRESS,
      expectedAmountWei: BigInt('5000000'),
      minConfirmations: MOCK_CONFIRMATIONS,
    });
  });

  // --- happy path ---

  it('records confirmed payment and returns paid:true on success', async () => {
    mockGetByNonce.mockResolvedValueOnce(null);
    mockVerifyPayment.mockResolvedValueOnce({ ok: true, blockNumber: 99 });

    const input = makeInput(validHeader());
    const result = await enforceX402(input);

    expect(result).toEqual({ paid: true, txHash: MOCK_TX_HASH });
    expect(mockRecordConfirmed).toHaveBeenCalledWith({
      idempotencyKey: 'a'.repeat(16),
      accountId: 'acct-1',
      amountWei: '5000000',
      assetSymbol: 'USDC',
      txHash: MOCK_TX_HASH,
      blockNumber: 99,
      resource: '/v1/data',
    });
  });

  it('does not record payment when verification fails', async () => {
    mockGetByNonce.mockResolvedValueOnce(null);
    mockVerifyPayment.mockResolvedValueOnce({ ok: false, reason: 'bad' });

    const input = makeInput(validHeader());
    try {
      await enforceX402(input);
    } catch {
      /* expected */
    }

    expect(mockRecordConfirmed).not.toHaveBeenCalled();
  });

  // --- usage tracking ---

  it('increments usage after successful payment', async () => {
    mockGetByNonce.mockResolvedValueOnce(null);
    mockVerifyPayment.mockResolvedValueOnce({ ok: true, blockNumber: 50 });

    const input = makeInput(validHeader());
    await enforceX402(input);

    expect(mockUsageIncrement).toHaveBeenCalledWith('acct-1', {
      resource: '/v1/data',
      txHash: MOCK_TX_HASH,
    });
  });

  it('does not increment usage when verification fails', async () => {
    mockGetByNonce.mockResolvedValueOnce(null);
    mockVerifyPayment.mockResolvedValueOnce({ ok: false, reason: 'bad' });

    const input = makeInput(validHeader());
    try {
      await enforceX402(input);
    } catch {
      /* expected */
    }

    expect(mockUsageIncrement).not.toHaveBeenCalled();
  });

  it('does not increment usage when nonce is reused', async () => {
    mockGetByNonce.mockResolvedValueOnce({ txHash: MOCK_TX_HASH });

    const input = makeInput(validHeader());
    try {
      await enforceX402(input);
    } catch {
      /* expected */
    }

    expect(mockUsageIncrement).not.toHaveBeenCalled();
  });

  // --- CAIP-2 network routing ---

  it('defaults to eip155 verification when no network in header', async () => {
    mockGetByNonce.mockResolvedValueOnce(null);
    mockVerifyPayment.mockResolvedValueOnce({ ok: true, blockNumber: 77 });

    const input = makeInput(validHeader());
    await enforceX402(input);

    expect(mockVerifyPayment).toHaveBeenCalledOnce();
  });

  it('routes to EVM verifier when network is eip155:8453', async () => {
    mockGetByNonce.mockResolvedValueOnce(null);
    mockVerifyPayment.mockResolvedValueOnce({ ok: true, blockNumber: 88 });

    const input = makeInput(validHeader({ network: 'eip155:8453' }));
    const result = await enforceX402(input);

    expect(result.paid).toBe(true);
    expect(mockVerifyPayment).toHaveBeenCalledOnce();
  });

  it('rejects unregistered eip155 chain with unsupported-network', async () => {
    mockGetByNonce.mockResolvedValueOnce(null);

    const input = makeInput(validHeader({ network: 'eip155:1' }));
    try {
      await enforceX402(input);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PaymentRequiredError);
      expect(e.challenge.reason).toBe('unsupported-network');
    }

    expect(mockVerifyPayment).not.toHaveBeenCalled();
  });

  it('rejects unsupported solana network with unsupported-network reason', async () => {
    mockGetByNonce.mockResolvedValueOnce(null);

    const solTxSig = '5' + 'K'.repeat(86);
    const input = makeInput(
      validHeader({
        network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        txHash: solTxSig,
      }),
    );

    try {
      await enforceX402(input);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PaymentRequiredError);
      expect(e.challenge.reason).toBe('unsupported-network');
    }

    expect(mockVerifyPayment).not.toHaveBeenCalled();
  });

  it('rejects unknown network prefix with unsupported-network reason', async () => {
    mockGetByNonce.mockResolvedValueOnce(null);

    const input = makeInput(validHeader({ network: 'cosmos:cosmoshub4' }));
    try {
      await enforceX402(input);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PaymentRequiredError);
      expect(e.challenge.reason).toBe('unsupported-network');
    }
  });

  it('emits paymentFailed metric for unsupported network', async () => {
    mockGetByNonce.mockResolvedValueOnce(null);

    const solTxSig = '5' + 'K'.repeat(86);
    const input = makeInput(
      validHeader({
        network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        txHash: solTxSig,
      }),
    );

    try {
      await enforceX402(input);
    } catch {
      /* expected */
    }
  });

  // --- accepts array content ---

  it('Base entry asset includes USDC contract address', async () => {
    const input = makeInput(null);
    try {
      await enforceX402(input);
      expect.unreachable();
    } catch (e) {
      const base = e.challenge.accepts[0];
      expect(base.asset).toBe(`USDC@${MOCK_USDC_CONTRACT}`);
      expect(base.scheme).toBe('exact');
    }
  });

  it('omits Solana from accepts when solana config is absent', async () => {
    const input = makeInput(null);
    try {
      await enforceX402(input);
      expect.unreachable();
    } catch (e) {
      expect(e.challenge.accepts).toHaveLength(1);
      expect(e.challenge.accepts[0].network).toBe(`eip155:${MOCK_CHAIN_ID}`);
    }
  });
});

describe('resolvePayToForNetwork', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the EVM address for eip155:* networks', () => {
    const cfg = makeConfig(MOCK_SOLANA_CONFIG, MOCK_XRPL_CONFIG);
    expect(resolvePayToForNetwork('eip155:8453', cfg, MOCK_ADDRESS)).toBe(MOCK_ADDRESS);
    expect(resolvePayToForNetwork('eip155:1440002', cfg, MOCK_ADDRESS)).toBe(MOCK_ADDRESS);
  });

  it('returns solana.payTo for solana:* networks', () => {
    const cfg = makeConfig(MOCK_SOLANA_CONFIG, MOCK_XRPL_CONFIG);
    expect(resolvePayToForNetwork(MOCK_SOLANA_CONFIG.network, cfg, MOCK_ADDRESS)).toBe(
      MOCK_SOLANA_CONFIG.payTo,
    );
  });

  it('returns xrpl.payTo for xrpl:* networks regardless of stage', () => {
    const cfg = makeConfig(undefined, MOCK_XRPL_CONFIG, 'prod');
    expect(resolvePayToForNetwork('xrpl:0', cfg, MOCK_ADDRESS)).toBe(MOCK_XRPL_CONFIG.payTo);
    expect(resolvePayToForNetwork('xrpl:1', cfg, MOCK_ADDRESS)).toBe(MOCK_XRPL_CONFIG.payTo);
  });

  it('returns null when the namespace is unknown or network is not a string', () => {
    const cfg = makeConfig(MOCK_SOLANA_CONFIG, MOCK_XRPL_CONFIG);
    expect(resolvePayToForNetwork('cosmos:cosmoshub4', cfg, MOCK_ADDRESS)).toBeNull();
    expect(resolvePayToForNetwork(undefined, cfg, MOCK_ADDRESS)).toBeNull();
    expect(resolvePayToForNetwork(null, cfg, MOCK_ADDRESS)).toBeNull();
  });

  it('returns null when the chain-specific config is missing', () => {
    const cfg = makeConfig(undefined, undefined);
    expect(
      resolvePayToForNetwork('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', cfg, MOCK_ADDRESS),
    ).toBeNull();
    expect(resolvePayToForNetwork('xrpl:0', cfg, MOCK_ADDRESS)).toBeNull();
  });

  it('passes the chain-specific payTo to the adapter for non-EVM networks', async () => {
    mockGetConfig.mockReturnValue(makeConfig(MOCK_SOLANA_CONFIG, MOCK_XRPL_CONFIG));
    mockGetChainAdapter.mockImplementation((network) => {
      if (network === MOCK_SOLANA_CONFIG.network) {
        return { name: 'solana', caip2: network, verifyPayment: mockVerifyPayment };
      }
      return undefined;
    });
    mockGetByNonce.mockResolvedValueOnce(null);
    mockVerifyPayment.mockResolvedValueOnce({ ok: true, blockNumber: 1 });

    const solTxSig = '5' + 'K'.repeat(86);
    const input = makeInput(validHeader({ network: MOCK_SOLANA_CONFIG.network, txHash: solTxSig }));
    await enforceX402(input);

    expect(mockVerifyPayment).toHaveBeenCalledWith(
      expect.objectContaining({ expectedTo: MOCK_SOLANA_CONFIG.payTo }),
    );
  });

  it('rejects with missing-payto when adapter is registered but chain config is absent', async () => {
    mockGetConfig.mockReturnValue(makeConfig(undefined, undefined));
    mockGetChainAdapter.mockImplementation((network) => {
      if (network === 'xrpl:1') {
        return { name: 'xrpl', caip2: network, verifyPayment: mockVerifyPayment };
      }
      return undefined;
    });
    mockGetByNonce.mockResolvedValueOnce(null);

    const input = makeInput(validHeader({ network: 'xrpl:1' }));
    try {
      await enforceX402(input);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PaymentRequiredError);
      expect(e.challenge.reason).toBe('missing-payto');
    }
    expect(mockVerifyPayment).not.toHaveBeenCalled();
  });
});

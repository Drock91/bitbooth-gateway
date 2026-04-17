import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetTransaction = vi.hoisted(() => vi.fn());
const mockGetSlot = vi.hoisted(() => vi.fn());
const MockConnection = vi.hoisted(() =>
  vi.fn(function () {
    this.getTransaction = mockGetTransaction;
    this.getSlot = mockGetSlot;
  }),
);

vi.mock('@solana/web3.js', () => ({ Connection: MockConnection }));

const DEST = '7cVfgArCheMR6Cs4t6vz5rfnqd56vZq4ndaBrY5xkxXy';
const OTHER = '9VfgArCheMR6Cs4t6vz5rfnqd56vZq4ndaBrY5xkxXyQ';
const TX_HASH =
  '5j7s6NiJS3JAkvgkoc18WVAsiSaci2pxB2A6ueCJP4tprA2TFg9wSyTLeYouxPBJEMzJinENTkpA52YStRW5Dia7';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DEVNET_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const OTHER_MINT = 'So11111111111111111111111111111111111111112';

function makeTx({
  slot = 100,
  err = null,
  owner = DEST,
  mint = USDC_DEVNET_MINT,
  preAmount = '0',
  postAmount = '1000000',
  accountIndex = 1,
  extraPost = [],
  extraPre = [],
} = {}) {
  return {
    slot,
    blockTime: 1700000000,
    meta: {
      err,
      fee: 5000,
      preTokenBalances: [
        { accountIndex, mint, owner, uiTokenAmount: { amount: preAmount, decimals: 6 } },
        ...extraPre,
      ],
      postTokenBalances: [
        { accountIndex, mint, owner, uiTokenAmount: { amount: postAmount, decimals: 6 } },
        ...extraPost,
      ],
    },
    transaction: { signatures: [TX_HASH], message: { accountKeys: [], instructions: [] } },
  };
}

async function freshImport() {
  vi.resetModules();
  MockConnection.mockClear();
  mockGetTransaction.mockClear();
  mockGetSlot.mockClear();
  vi.doMock('@solana/web3.js', () => ({ Connection: MockConnection }));
  return import('../../src/adapters/solana/client.js');
}

describe('solana/client', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SOLANA_RPC_URL;
    delete process.env.SOLANA_USDC_MINT;
    delete process.env.SOLANA_MIN_CONFIRMATION_SLOTS;
    delete process.env.STAGE;
    mockGetSlot.mockResolvedValue(200);
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  describe('constants', () => {
    it('exports canonical USDC mainnet mint', async () => {
      const mod = await freshImport();
      expect(mod.USDC_MAINNET_MINT).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    });

    it('exports mainnet + devnet RPC URLs', async () => {
      const mod = await freshImport();
      expect(mod.MAINNET_RPC).toBe('https://api.mainnet-beta.solana.com');
      expect(mod.DEVNET_RPC).toBe('https://api.devnet.solana.com');
    });

    it('exports DEFAULT_MIN_CONFIRMATION_SLOTS of 15', async () => {
      const { DEFAULT_MIN_CONFIRMATION_SLOTS } = await freshImport();
      expect(DEFAULT_MIN_CONFIRMATION_SLOTS).toBe(15);
    });
  });

  describe('getRpcUrl', () => {
    it('returns SOLANA_RPC_URL env var when set', async () => {
      process.env.SOLANA_RPC_URL = 'https://rpc.custom.com';
      const { getRpcUrl } = await freshImport();
      expect(getRpcUrl()).toBe('https://rpc.custom.com');
    });

    it('returns mainnet when STAGE=prod', async () => {
      process.env.STAGE = 'prod';
      const { getRpcUrl } = await freshImport();
      expect(getRpcUrl()).toBe('https://api.mainnet-beta.solana.com');
    });

    it('returns devnet when STAGE unset (default dev)', async () => {
      const { getRpcUrl } = await freshImport();
      expect(getRpcUrl()).toBe('https://api.devnet.solana.com');
    });

    it('returns devnet when STAGE=staging', async () => {
      process.env.STAGE = 'staging';
      const { getRpcUrl } = await freshImport();
      expect(getRpcUrl()).toBe('https://api.devnet.solana.com');
    });
  });

  describe('getUsdcMint', () => {
    it('returns SOLANA_USDC_MINT env var when set', async () => {
      process.env.SOLANA_USDC_MINT = 'CustomMint111111111111111111111111111111111';
      const { getUsdcMint } = await freshImport();
      expect(getUsdcMint()).toBe('CustomMint111111111111111111111111111111111');
    });

    it('returns mainnet mint when STAGE=prod', async () => {
      process.env.STAGE = 'prod';
      const { getUsdcMint } = await freshImport();
      expect(getUsdcMint()).toBe(USDC_MINT);
    });

    it('returns devnet mint when STAGE=dev', async () => {
      process.env.STAGE = 'dev';
      const { getUsdcMint } = await freshImport();
      expect(getUsdcMint()).toBe(USDC_DEVNET_MINT);
    });
  });

  describe('getConnection', () => {
    it('creates Connection with confirmed commitment', async () => {
      const { getConnection } = await freshImport();
      getConnection();
      expect(MockConnection).toHaveBeenCalledWith('https://api.devnet.solana.com', 'confirmed');
    });

    it('caches the Connection instance', async () => {
      const { getConnection } = await freshImport();
      getConnection();
      getConnection();
      expect(MockConnection).toHaveBeenCalledTimes(1);
    });
  });

  describe('getTransaction', () => {
    it('returns tx on success', async () => {
      const tx = makeTx();
      mockGetTransaction.mockResolvedValue(tx);
      const { getTransaction } = await freshImport();
      const result = await getTransaction(TX_HASH);
      expect(result).toEqual(tx);
    });

    it('calls getTransaction with versioned tx opts', async () => {
      mockGetTransaction.mockResolvedValue(makeTx());
      const { getTransaction } = await freshImport();
      await getTransaction(TX_HASH);
      expect(mockGetTransaction).toHaveBeenCalledWith(TX_HASH, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });
    });

    it('throws UpstreamError when RPC returns null', async () => {
      mockGetTransaction.mockResolvedValue(null);
      const { getTransaction } = await freshImport();
      await expect(getTransaction(TX_HASH)).rejects.toThrow('Upstream solana failed');
    });

    it('propagates RPC network errors', async () => {
      mockGetTransaction.mockRejectedValue(new Error('ECONNREFUSED'));
      const { getTransaction } = await freshImport();
      await expect(getTransaction(TX_HASH)).rejects.toThrow();
    });
  });

  describe('getSlot', () => {
    it('returns current slot from Connection', async () => {
      mockGetSlot.mockResolvedValue(555);
      const { getSlot } = await freshImport();
      expect(await getSlot()).toBe(555);
    });
  });

  describe('verifyPayment — happy path', () => {
    const input = {
      txHash: TX_HASH,
      expectedTo: DEST,
      expectedAmountWei: 1000000n,
      minConfirmations: 15,
    };

    it('returns ok:true for exact USDC transfer with sufficient depth', async () => {
      mockGetTransaction.mockResolvedValue(
        makeTx({ slot: 100, preAmount: '0', postAmount: '1000000' }),
      );
      mockGetSlot.mockResolvedValue(200);
      const { verifyPayment } = await freshImport();
      const result = await verifyPayment(input);
      expect(result).toEqual({ ok: true, blockNumber: 100 });
    });

    it('accepts overpayment', async () => {
      mockGetTransaction.mockResolvedValue(makeTx({ preAmount: '0', postAmount: '5000000' }));
      const { verifyPayment } = await freshImport();
      const result = await verifyPayment(input);
      expect(result.ok).toBe(true);
    });

    it('credits delta when recipient had prior balance', async () => {
      mockGetTransaction.mockResolvedValue(makeTx({ preAmount: '2000000', postAmount: '3000000' }));
      const { verifyPayment } = await freshImport();
      const result = await verifyPayment(input);
      expect(result.ok).toBe(true);
    });

    it('accepts recipient with no prior token account (no preMatch)', async () => {
      const tx = makeTx({ postAmount: '1000000' });
      tx.meta.preTokenBalances = [];
      mockGetTransaction.mockResolvedValue(tx);
      const { verifyPayment } = await freshImport();
      const result = await verifyPayment(input);
      expect(result.ok).toBe(true);
    });
  });

  describe('verifyPayment — rejections', () => {
    const input = {
      txHash: TX_HASH,
      expectedTo: DEST,
      expectedAmountWei: 1000000n,
      minConfirmations: 15,
    };

    it('rejects failed tx (meta.err !== null)', async () => {
      mockGetTransaction.mockResolvedValue(makeTx({ err: { InstructionError: [0, 'Custom'] } }));
      const { verifyPayment } = await freshImport();
      const result = await verifyPayment(input);
      expect(result).toEqual({ ok: false, reason: 'tx-failed' });
    });

    it('rejects when no USDC balance entry for expectedTo', async () => {
      mockGetTransaction.mockResolvedValue(makeTx({ owner: OTHER }));
      const { verifyPayment } = await freshImport();
      const result = await verifyPayment(input);
      expect(result).toEqual({ ok: false, reason: 'no-usdc-transfer-to-destination' });
    });

    it('rejects when mint is wrong (wrong token)', async () => {
      mockGetTransaction.mockResolvedValue(makeTx({ mint: OTHER_MINT }));
      const { verifyPayment } = await freshImport();
      const result = await verifyPayment(input);
      expect(result).toEqual({ ok: false, reason: 'no-usdc-transfer-to-destination' });
    });

    it('rejects underpayment', async () => {
      mockGetTransaction.mockResolvedValue(makeTx({ preAmount: '0', postAmount: '500000' }));
      const { verifyPayment } = await freshImport();
      const result = await verifyPayment(input);
      expect(result).toEqual({ ok: false, reason: 'amount-mismatch' });
    });

    it('rejects zero delta (no transfer)', async () => {
      mockGetTransaction.mockResolvedValue(makeTx({ preAmount: '1000000', postAmount: '1000000' }));
      const { verifyPayment } = await freshImport();
      const result = await verifyPayment(input);
      expect(result).toEqual({ ok: false, reason: 'amount-mismatch' });
    });

    it('rejects insufficient confirmation depth', async () => {
      mockGetTransaction.mockResolvedValue(
        makeTx({ slot: 195, preAmount: '0', postAmount: '1000000' }),
      );
      mockGetSlot.mockResolvedValue(200);
      const { verifyPayment } = await freshImport();
      const result = await verifyPayment(input);
      expect(result).toEqual({ ok: false, reason: 'insufficient-confirmations' });
    });

    it('returns invalid-tx-shape for malformed tx (missing slot)', async () => {
      mockGetTransaction.mockResolvedValue({ meta: { err: null } });
      const { verifyPayment } = await freshImport();
      const result = await verifyPayment(input);
      expect(result).toEqual({ ok: false, reason: 'invalid-tx-shape' });
    });
  });

  describe('verifyPayment — configuration knobs', () => {
    it('honours SOLANA_MIN_CONFIRMATION_SLOTS env override', async () => {
      process.env.SOLANA_MIN_CONFIRMATION_SLOTS = '5';
      mockGetTransaction.mockResolvedValue(
        makeTx({ slot: 100, preAmount: '0', postAmount: '1000000' }),
      );
      mockGetSlot.mockResolvedValue(106);
      const { verifyPayment } = await freshImport();
      const result = await verifyPayment({
        txHash: TX_HASH,
        expectedTo: DEST,
        expectedAmountWei: 1000000n,
        minConfirmations: 15,
      });
      expect(result.ok).toBe(true);
    });

    it('uses custom USDC mint when SOLANA_USDC_MINT is set', async () => {
      const customMint = 'CustMintXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
      process.env.SOLANA_USDC_MINT = customMint;
      mockGetTransaction.mockResolvedValue(
        makeTx({ mint: customMint, preAmount: '0', postAmount: '1000000' }),
      );
      const { verifyPayment } = await freshImport();
      const result = await verifyPayment({
        txHash: TX_HASH,
        expectedTo: DEST,
        expectedAmountWei: 1000000n,
        minConfirmations: 15,
      });
      expect(result.ok).toBe(true);
    });

    it('defaults minConfirmations to 15 when not provided', async () => {
      mockGetTransaction.mockResolvedValue(
        makeTx({ slot: 100, preAmount: '0', postAmount: '1000000' }),
      );
      mockGetSlot.mockResolvedValue(114);
      const { verifyPayment } = await freshImport();
      const result = await verifyPayment({
        txHash: TX_HASH,
        expectedTo: DEST,
        expectedAmountWei: 1000000n,
      });
      expect(result).toEqual({ ok: false, reason: 'insufficient-confirmations' });
    });
  });

  describe('_resetConnection / _resetBreaker', () => {
    it('clears cached Connection so the next call re-constructs', async () => {
      const { getConnection, _resetConnection } = await freshImport();
      getConnection();
      _resetConnection();
      getConnection();
      expect(MockConnection).toHaveBeenCalledTimes(2);
    });

    it('_resetBreaker does not throw', async () => {
      const { _resetBreaker } = await freshImport();
      expect(() => _resetBreaker()).not.toThrow();
    });
  });
});

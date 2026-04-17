import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetConfig = vi.hoisted(() => vi.fn());
const mockGetSecret = vi.hoisted(() => vi.fn());
const mockGetAdapterTimeoutMs = vi.hoisted(() => vi.fn(() => 10_000));
const mockGetTransactionReceipt = vi.hoisted(() => vi.fn());
const mockGetBlockNumber = vi.hoisted(() => vi.fn());
const mockCreatePublicClient = vi.hoisted(() =>
  vi.fn(() => ({
    getTransactionReceipt: mockGetTransactionReceipt,
    getBlockNumber: mockGetBlockNumber,
  })),
);

vi.mock('viem', () => ({
  createPublicClient: mockCreatePublicClient,
  http: vi.fn((url, opts) => ({ url, ...opts })),
  keccak256: vi.fn(() => '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'),
  toHex: vi.fn((s) => '0x' + Buffer.from(s).toString('hex')),
}));

vi.mock('viem/chains', () => ({
  base: { id: 8453, name: 'Base' },
}));

vi.mock('../../src/lib/config.js', () => ({
  getConfig: mockGetConfig,
}));

vi.mock('../../src/lib/secrets.js', () => ({
  getSecret: mockGetSecret,
  getSecretJson: vi.fn(),
}));

vi.mock('../../src/lib/http.js', () => ({
  getAdapterTimeoutMs: mockGetAdapterTimeoutMs,
}));

const DEFAULT_CONFIG = {
  chain: {
    rpcUrl: 'https://rpc.example.com',
    chainId: 8453,
    usdcContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    requiredConfirmations: 2,
  },
  secretArns: { agentWallet: 'arn:aws:sm:us-east-1:123:secret:wallet' },
};

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const RECIPIENT = 'aabbccddee1234567890aabbccddee12345678ab';

async function freshImport() {
  vi.resetModules();
  vi.doMock('viem', () => ({
    createPublicClient: mockCreatePublicClient,
    http: vi.fn((url, opts) => ({ url, ...opts })),
    keccak256: vi.fn(() => TRANSFER_TOPIC),
    toHex: vi.fn((s) => '0x' + Buffer.from(s).toString('hex')),
  }));
  vi.doMock('viem/chains', () => ({ base: { id: 8453, name: 'Base' } }));
  vi.doMock('../../src/lib/config.js', () => ({ getConfig: mockGetConfig }));
  vi.doMock('../../src/lib/secrets.js', () => ({
    getSecret: mockGetSecret,
    getSecretJson: vi.fn(),
  }));
  vi.doMock('../../src/lib/http.js', () => ({ getAdapterTimeoutMs: mockGetAdapterTimeoutMs }));
  return import('../../src/adapters/base/client.js');
}

function makeReceipt({ status = 'success', logs = [], blockNumber = 42n } = {}) {
  return { status, logs, blockNumber };
}

function makeTransferLog({ contract = BASE_USDC, to = RECIPIENT, amount = 1000n } = {}) {
  return {
    address: contract,
    topics: [TRANSFER_TOPIC, '0x' + '0'.repeat(64), '0x' + '0'.repeat(24) + to],
    data: '0x' + amount.toString(16).padStart(64, '0'),
  };
}

describe('base/client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockReturnValue(DEFAULT_CONFIG);
  });

  describe('constants', () => {
    it('exports BASE_CHAIN_ID as 8453', async () => {
      const { BASE_CHAIN_ID } = await freshImport();
      expect(BASE_CHAIN_ID).toBe(8453);
    });

    it('exports BASE_USDC contract address', async () => {
      const mod = await freshImport();
      expect(mod.BASE_USDC).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    });
  });

  describe('getClient (via getTransactionReceipt)', () => {
    it('uses RPC URL from secret when baseRpc ARN is set', async () => {
      const cfg = {
        ...DEFAULT_CONFIG,
        secretArns: { ...DEFAULT_CONFIG.secretArns, baseRpc: 'arn:secret:base-rpc' },
      };
      mockGetConfig.mockReturnValue(cfg);
      mockGetSecret.mockResolvedValue('https://secret-rpc.example.com');
      mockGetTransactionReceipt.mockResolvedValue(makeReceipt());
      const { getTransactionReceipt } = await freshImport();

      await getTransactionReceipt('0x' + 'a'.repeat(64));
      expect(mockGetSecret).toHaveBeenCalledWith('arn:secret:base-rpc');
    });

    it('falls back to env RPC URL when baseRpc is not set', async () => {
      mockGetTransactionReceipt.mockResolvedValue(makeReceipt());
      const { getTransactionReceipt } = await freshImport();

      await getTransactionReceipt('0x' + 'a'.repeat(64));
      expect(mockGetSecret).not.toHaveBeenCalled();
    });

    it('throws UpstreamError when no RPC URL available', async () => {
      mockGetConfig.mockReturnValue({
        chain: { chainId: 8453, usdcContract: BASE_USDC },
        secretArns: { agentWallet: 'arn:wallet' },
      });
      const { getTransactionReceipt } = await freshImport();

      await expect(getTransactionReceipt('0x' + 'a'.repeat(64))).rejects.toThrow(
        'Upstream base-chain failed',
      );
    });

    it('caches client across calls', async () => {
      mockGetTransactionReceipt.mockResolvedValue(makeReceipt());
      const { getTransactionReceipt } = await freshImport();

      await getTransactionReceipt('0x' + 'a'.repeat(64));
      await getTransactionReceipt('0x' + 'b'.repeat(64));
      expect(mockCreatePublicClient).toHaveBeenCalledTimes(1);
    });

    it('passes timeout from getAdapterTimeoutMs', async () => {
      mockGetAdapterTimeoutMs.mockReturnValue(15_000);
      mockGetTransactionReceipt.mockResolvedValue(makeReceipt());
      const { getTransactionReceipt } = await freshImport();

      await getTransactionReceipt('0x' + 'a'.repeat(64));
      expect(mockGetAdapterTimeoutMs).toHaveBeenCalled();
    });
  });

  describe('getTransactionReceipt', () => {
    it('returns receipt when found', async () => {
      const receipt = makeReceipt({ blockNumber: 100n });
      mockGetTransactionReceipt.mockResolvedValue(receipt);
      const { getTransactionReceipt } = await freshImport();

      const result = await getTransactionReceipt('0x' + 'a'.repeat(64));
      expect(result).toBe(receipt);
    });

    it('throws UpstreamError when receipt is null', async () => {
      mockGetTransactionReceipt.mockResolvedValue(null);
      const { getTransactionReceipt } = await freshImport();

      await expect(getTransactionReceipt('0x' + 'a'.repeat(64))).rejects.toThrow(
        'Upstream base-chain failed',
      );
    });
  });

  describe('verifyPayment', () => {
    const baseInput = {
      txHash: '0x' + 'a'.repeat(64),
      expectedTo: '0x' + RECIPIENT,
      expectedAmountWei: 500n,
      minConfirmations: 2,
    };

    it('returns tx-reverted when receipt status is reverted', async () => {
      mockGetTransactionReceipt.mockResolvedValue(makeReceipt({ status: 'reverted' }));
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment(baseInput);
      expect(result).toEqual({ ok: false, reason: 'tx-reverted' });
    });

    it('returns no-usdc-transfer when no matching logs', async () => {
      mockGetTransactionReceipt.mockResolvedValue(makeReceipt({ status: 'success', logs: [] }));
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment(baseInput);
      expect(result).toEqual({ ok: false, reason: 'no-usdc-transfer' });
    });

    it('returns no-usdc-transfer when log is from wrong contract', async () => {
      const wrongLog = makeTransferLog({ contract: '0x' + '1'.repeat(40) });
      mockGetTransactionReceipt.mockResolvedValue(
        makeReceipt({ status: 'success', logs: [wrongLog] }),
      );
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment(baseInput);
      expect(result).toEqual({ ok: false, reason: 'no-usdc-transfer' });
    });

    it('returns no-usdc-transfer when topic[0] is not Transfer', async () => {
      const badLog = {
        address: BASE_USDC,
        topics: ['0xbadtopic', '0x' + '0'.repeat(64), '0x' + '0'.repeat(64)],
        data: '0x' + '0'.repeat(64),
      };
      mockGetTransactionReceipt.mockResolvedValue(
        makeReceipt({ status: 'success', logs: [badLog] }),
      );
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment(baseInput);
      expect(result).toEqual({ ok: false, reason: 'no-usdc-transfer' });
    });

    it('returns no-usdc-transfer when log has fewer than 3 topics', async () => {
      const shortLog = {
        address: BASE_USDC,
        topics: [TRANSFER_TOPIC],
        data: '0x' + '0'.repeat(64),
      };
      mockGetTransactionReceipt.mockResolvedValue(
        makeReceipt({ status: 'success', logs: [shortLog] }),
      );
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment(baseInput);
      expect(result).toEqual({ ok: false, reason: 'no-usdc-transfer' });
    });

    it('returns no-usdc-transfer when topics is null/undefined', async () => {
      const noTopicsLog = { address: BASE_USDC, data: '0x' + '0'.repeat(64) };
      mockGetTransactionReceipt.mockResolvedValue(
        makeReceipt({ status: 'success', logs: [noTopicsLog] }),
      );
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment(baseInput);
      expect(result).toEqual({ ok: false, reason: 'no-usdc-transfer' });
    });

    it('returns wrong-recipient when to address does not match', async () => {
      const log = makeTransferLog();
      mockGetTransactionReceipt.mockResolvedValue(makeReceipt({ status: 'success', logs: [log] }));
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment({
        ...baseInput,
        expectedTo: '0x' + '9'.repeat(40),
      });
      expect(result).toEqual({ ok: false, reason: 'wrong-recipient' });
    });

    it('returns amount-too-low when transfer amount is less than expected', async () => {
      const log = makeTransferLog({ amount: 100n });
      mockGetTransactionReceipt.mockResolvedValue(makeReceipt({ status: 'success', logs: [log] }));
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment({ ...baseInput, expectedAmountWei: 500n });
      expect(result).toEqual({ ok: false, reason: 'amount-too-low' });
    });

    it('returns insufficient-confirmations when below threshold', async () => {
      const log = makeTransferLog({ amount: 1000n });
      mockGetTransactionReceipt.mockResolvedValue(
        makeReceipt({ status: 'success', logs: [log], blockNumber: 100n }),
      );
      mockGetBlockNumber.mockResolvedValue(100n);
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment({ ...baseInput, minConfirmations: 2 });
      expect(result).toEqual({ ok: false, reason: 'insufficient-confirmations' });
    });

    it('returns ok:true with blockNumber on success', async () => {
      const log = makeTransferLog({ amount: 1000n });
      mockGetTransactionReceipt.mockResolvedValue(
        makeReceipt({ status: 'success', logs: [log], blockNumber: 99n }),
      );
      mockGetBlockNumber.mockResolvedValue(110n);
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment({ ...baseInput, minConfirmations: 2 });
      expect(result).toEqual({ ok: true, blockNumber: 99 });
    });

    it('accepts exact amount', async () => {
      const log = makeTransferLog({ amount: 500n });
      mockGetTransactionReceipt.mockResolvedValue(
        makeReceipt({ status: 'success', logs: [log], blockNumber: 50n }),
      );
      mockGetBlockNumber.mockResolvedValue(55n);
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment({ ...baseInput, expectedAmountWei: 500n });
      expect(result).toEqual({ ok: true, blockNumber: 50 });
    });

    it('case-insensitive USDC contract matching', async () => {
      const log = makeTransferLog({ contract: BASE_USDC.toUpperCase() });
      mockGetTransactionReceipt.mockResolvedValue(
        makeReceipt({ status: 'success', logs: [log], blockNumber: 77n }),
      );
      mockGetBlockNumber.mockResolvedValue(80n);
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment({ ...baseInput, minConfirmations: 2 });
      expect(result).toEqual({ ok: true, blockNumber: 77 });
    });

    it('case-insensitive recipient matching', async () => {
      const log = makeTransferLog();
      mockGetTransactionReceipt.mockResolvedValue(
        makeReceipt({ status: 'success', logs: [log], blockNumber: 60n }),
      );
      mockGetBlockNumber.mockResolvedValue(65n);
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment({
        ...baseInput,
        expectedTo: ('0x' + RECIPIENT).toUpperCase(),
      });
      expect(result).toEqual({ ok: true, blockNumber: 60 });
    });

    it('converts bigint blockNumber to number', async () => {
      const log = makeTransferLog({ amount: 1000n });
      mockGetTransactionReceipt.mockResolvedValue(
        makeReceipt({ status: 'success', logs: [log], blockNumber: 12345n }),
      );
      mockGetBlockNumber.mockResolvedValue(12350n);
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment(baseInput);
      expect(typeof result.blockNumber).toBe('number');
      expect(result.blockNumber).toBe(12345);
    });

    it('confirmation depth uses current block minus receipt block', async () => {
      const log = makeTransferLog({ amount: 1000n });
      mockGetTransactionReceipt.mockResolvedValue(
        makeReceipt({ status: 'success', logs: [log], blockNumber: 100n }),
      );
      mockGetBlockNumber.mockResolvedValue(101n);
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment({ ...baseInput, minConfirmations: 2 });
      expect(result).toEqual({ ok: false, reason: 'insufficient-confirmations' });

      mockGetBlockNumber.mockResolvedValue(102n);
      const result2 = await verifyPayment({ ...baseInput, minConfirmations: 2 });
      expect(result2).toEqual({ ok: true, blockNumber: 100 });
    });
  });

  describe('_resetBreaker', () => {
    it('resets circuit breaker without throwing', async () => {
      const { _resetBreaker } = await freshImport();
      expect(() => _resetBreaker()).not.toThrow();
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetConfig = vi.hoisted(() => vi.fn());
const mockGetSecret = vi.hoisted(() => vi.fn());
const mockGetSecretJson = vi.hoisted(() => vi.fn());
const mockGetTransaction = vi.hoisted(() => vi.fn());
const mockGetTransactionReceipt = vi.hoisted(() => vi.fn());
const mockWalletInstance = vi.hoisted(() => ({ address: '0xAgentAddress' }));
const mockKeccak256 = vi.hoisted(() => vi.fn(() => '0xddf252topic'));
const mockGetAdapterTimeoutMs = vi.hoisted(() => vi.fn(() => 10_000));
const mockFetchRequestInstances = vi.hoisted(() => []);

vi.mock('ethers', () => ({
  FetchRequest: vi.fn(function (url) {
    this.url = url;
    mockFetchRequestInstances.push(this);
  }),
  JsonRpcProvider: vi.fn(function () {
    this.getTransaction = mockGetTransaction;
    this.getTransactionReceipt = mockGetTransactionReceipt;
  }),
  Wallet: vi.fn(function () {
    Object.assign(this, mockWalletInstance);
  }),
  id: mockKeccak256,
}));

vi.mock('../../src/lib/config.js', () => ({
  getConfig: mockGetConfig,
}));

vi.mock('../../src/lib/secrets.js', () => ({
  getSecret: mockGetSecret,
  getSecretJson: mockGetSecretJson,
}));

vi.mock('../../src/lib/http.js', () => ({
  getAdapterTimeoutMs: mockGetAdapterTimeoutMs,
}));

const DEFAULT_CONFIG = {
  chain: {
    rpcUrl: 'https://rpc.example.com',
    chainId: 8453,
    usdcContract: '0xUSDCcontract1234567890abcdef12345678',
  },
  secretArns: { agentWallet: 'arn:aws:secretsmanager:us-east-1:123:secret:wallet' },
};

// Must re-import each test since module caches provider/signer
async function freshImport() {
  vi.resetModules();
  mockFetchRequestInstances.length = 0;
  // Re-apply mocks after resetModules
  vi.doMock('ethers', () => ({
    FetchRequest: vi.fn(function (url) {
      this.url = url;
      mockFetchRequestInstances.push(this);
    }),
    JsonRpcProvider: vi.fn(function () {
      this.getTransaction = mockGetTransaction;
      this.getTransactionReceipt = mockGetTransactionReceipt;
    }),
    Wallet: vi.fn(function () {
      Object.assign(this, mockWalletInstance);
    }),
    id: mockKeccak256,
  }));
  vi.doMock('../../src/lib/config.js', () => ({ getConfig: mockGetConfig }));
  vi.doMock('../../src/lib/secrets.js', () => ({
    getSecret: mockGetSecret,
    getSecretJson: mockGetSecretJson,
  }));
  vi.doMock('../../src/lib/http.js', () => ({ getAdapterTimeoutMs: mockGetAdapterTimeoutMs }));
  return import('../../src/adapters/xrpl-evm/client.js');
}

describe('xrpl-evm/client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockReturnValue(DEFAULT_CONFIG);
    mockGetSecretJson.mockResolvedValue({ privateKey: '0xdeadbeef' });
  });

  describe('getAgentAddress', () => {
    it('returns the signer wallet address', async () => {
      const { getAgentAddress } = await freshImport();
      const addr = await getAgentAddress();
      expect(addr).toBe('0xAgentAddress');
    });

    it('loads private key from secrets manager', async () => {
      const { getAgentAddress } = await freshImport();
      await getAgentAddress();
      expect(mockGetSecretJson).toHaveBeenCalledWith(DEFAULT_CONFIG.secretArns.agentWallet);
    });

    it('caches the signer across calls', async () => {
      const { getAgentAddress } = await freshImport();
      await getAgentAddress();
      await getAgentAddress();
      expect(mockGetSecretJson).toHaveBeenCalledTimes(1);
    });
  });

  describe('getProvider (via getTransaction)', () => {
    it('uses RPC URL from secret when baseRpc ARN is configured', async () => {
      const configWithBaseRpc = {
        ...DEFAULT_CONFIG,
        secretArns: {
          ...DEFAULT_CONFIG.secretArns,
          baseRpc: 'arn:aws:secretsmanager:us-east-1:123:secret:base-rpc',
        },
      };
      mockGetConfig.mockReturnValue(configWithBaseRpc);
      mockGetSecret.mockResolvedValue('https://secret-rpc.example.com');
      const fakeTx = { hash: '0xabc' };
      mockGetTransaction.mockResolvedValue(fakeTx);
      const { getTransaction } = await freshImport();

      await getTransaction('0xabc');
      expect(mockGetSecret).toHaveBeenCalledWith(
        'arn:aws:secretsmanager:us-east-1:123:secret:base-rpc',
      );
    });

    it('falls back to env RPC URL when baseRpc ARN is not set', async () => {
      mockGetConfig.mockReturnValue(DEFAULT_CONFIG);
      const fakeTx = { hash: '0xabc' };
      mockGetTransaction.mockResolvedValue(fakeTx);
      const { getTransaction } = await freshImport();

      await getTransaction('0xabc');
      expect(mockGetSecret).not.toHaveBeenCalled();
    });

    it('throws UpstreamError when neither baseRpc secret nor rpcUrl is configured', async () => {
      const noRpcConfig = {
        chain: { chainId: 8453, usdcContract: DEFAULT_CONFIG.chain.usdcContract },
        secretArns: { agentWallet: DEFAULT_CONFIG.secretArns.agentWallet },
      };
      mockGetConfig.mockReturnValue(noRpcConfig);
      const { getTransaction } = await freshImport();

      await expect(getTransaction('0xabc')).rejects.toThrow('Upstream chain failed');
    });

    it('caches provider across calls (secret fetched once)', async () => {
      const configWithBaseRpc = {
        ...DEFAULT_CONFIG,
        secretArns: { ...DEFAULT_CONFIG.secretArns, baseRpc: 'arn:secret:rpc' },
      };
      mockGetConfig.mockReturnValue(configWithBaseRpc);
      mockGetSecret.mockResolvedValue('https://secret-rpc.example.com');
      const fakeTx = { hash: '0xabc' };
      mockGetTransaction.mockResolvedValue(fakeTx);
      const { getTransaction } = await freshImport();

      await getTransaction('0xabc');
      await getTransaction('0xdef');
      expect(mockGetSecret).toHaveBeenCalledTimes(1);
    });

    it('creates a FetchRequest with the RPC URL', async () => {
      const fakeTx = { hash: '0xabc' };
      mockGetTransaction.mockResolvedValue(fakeTx);
      const { getTransaction } = await freshImport();

      await getTransaction('0xabc');
      expect(mockFetchRequestInstances.length).toBe(1);
      expect(mockFetchRequestInstances[0].url).toBe('https://rpc.example.com');
    });

    it('sets timeout on FetchRequest from getAdapterTimeoutMs()', async () => {
      mockGetAdapterTimeoutMs.mockReturnValue(15_000);
      const fakeTx = { hash: '0xabc' };
      mockGetTransaction.mockResolvedValue(fakeTx);
      const { getTransaction } = await freshImport();

      await getTransaction('0xabc');
      expect(mockFetchRequestInstances[0].timeout).toBe(15_000);
      expect(mockGetAdapterTimeoutMs).toHaveBeenCalled();
    });

    it('passes FetchRequest instance to JsonRpcProvider constructor', async () => {
      const fakeTx = { hash: '0xabc' };
      mockGetTransaction.mockResolvedValue(fakeTx);
      const { getTransaction } = await freshImport();

      await getTransaction('0xabc');
      const { JsonRpcProvider: MockProvider } = await import('ethers');
      expect(MockProvider).toHaveBeenCalledWith(
        mockFetchRequestInstances[0],
        DEFAULT_CONFIG.chain.chainId,
      );
    });
  });

  describe('getTransaction', () => {
    it('returns transaction when found', async () => {
      const fakeTx = { hash: '0xabc', confirmations: vi.fn() };
      mockGetTransaction.mockResolvedValue(fakeTx);
      const { getTransaction } = await freshImport();

      const result = await getTransaction('0xabc');
      expect(result).toBe(fakeTx);
      expect(mockGetTransaction).toHaveBeenCalledWith('0xabc');
    });

    it('throws UpstreamError when tx not found', async () => {
      mockGetTransaction.mockResolvedValue(null);
      const { getTransaction } = await freshImport();

      await expect(getTransaction('0xmissing')).rejects.toThrow('Upstream chain failed');
    });

    it('includes txHash in error details', async () => {
      mockGetTransaction.mockResolvedValue(null);
      const { getTransaction } = await freshImport();

      try {
        await getTransaction('0xmissing');
        expect.fail('should have thrown');
      } catch (e) {
        expect(e.details).toEqual({ reason: 'tx-not-found', txHash: '0xmissing' });
        expect(e.status).toBe(502);
      }
    });
  });

  describe('getTransactionReceipt', () => {
    it('returns receipt when found', async () => {
      const fakeReceipt = { status: 1, blockNumber: 100 };
      mockGetTransactionReceipt.mockResolvedValue(fakeReceipt);
      const { getTransactionReceipt } = await freshImport();

      const result = await getTransactionReceipt('0xabc');
      expect(result).toBe(fakeReceipt);
    });

    it('throws UpstreamError when receipt not found', async () => {
      mockGetTransactionReceipt.mockResolvedValue(null);
      const { getTransactionReceipt } = await freshImport();

      await expect(getTransactionReceipt('0xnone')).rejects.toThrow('Upstream chain failed');
    });

    it('includes receipt-not-found reason in error details', async () => {
      mockGetTransactionReceipt.mockResolvedValue(null);
      const { getTransactionReceipt } = await freshImport();

      try {
        await getTransactionReceipt('0xnone');
        expect.fail('should have thrown');
      } catch (e) {
        expect(e.details).toEqual({ reason: 'receipt-not-found', txHash: '0xnone' });
      }
    });
  });

  describe('getConfirmations', () => {
    it('returns confirmation count from transaction', async () => {
      const fakeTx = { confirmations: vi.fn().mockResolvedValue(5) };
      mockGetTransaction.mockResolvedValue(fakeTx);
      const { getConfirmations } = await freshImport();

      const confs = await getConfirmations('0xabc');
      expect(confs).toBe(5);
    });

    it('throws when underlying tx is not found', async () => {
      mockGetTransaction.mockResolvedValue(null);
      const { getConfirmations } = await freshImport();

      await expect(getConfirmations('0xmissing')).rejects.toThrow('Upstream chain failed');
    });
  });

  describe('verifyPayment', () => {
    const TRANSFER_TOPIC = '0xddf252topic';
    const USDC_ADDR = DEFAULT_CONFIG.chain.usdcContract;
    const RECIPIENT_ADDR = 'aabbccddee1234567890aabbccddee12345678ab';

    function makeReceipt({ status = 1, logs = [], blockNumber = 42 } = {}) {
      return { status, logs, blockNumber };
    }

    function makeTransferLog({ contract = USDC_ADDR, to = RECIPIENT_ADDR, amount = 1000n } = {}) {
      return {
        address: contract,
        topics: [TRANSFER_TOPIC, '0x' + '0'.repeat(64), '0x' + '0'.repeat(24) + to],
        data: '0x' + amount.toString(16).padStart(64, '0'),
      };
    }

    const baseInput = {
      txHash: '0xtx1',
      expectedTo: '0x' + RECIPIENT_ADDR,
      expectedAmountWei: 500n,
      minConfirmations: 2,
    };

    it('returns tx-reverted when receipt status is 0', async () => {
      mockGetTransactionReceipt.mockResolvedValue(makeReceipt({ status: 0 }));
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment(baseInput);
      expect(result).toEqual({ ok: false, reason: 'tx-reverted' });
    });

    it('returns no-usdc-transfer when no matching logs', async () => {
      mockGetTransactionReceipt.mockResolvedValue(makeReceipt({ status: 1, logs: [] }));
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment(baseInput);
      expect(result).toEqual({ ok: false, reason: 'no-usdc-transfer' });
    });

    it('returns no-usdc-transfer when log is from wrong contract', async () => {
      const wrongLog = makeTransferLog({ contract: '0xWrongContract567890abcdef1234567890ab' });
      mockGetTransactionReceipt.mockResolvedValue(makeReceipt({ status: 1, logs: [wrongLog] }));
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment(baseInput);
      expect(result).toEqual({ ok: false, reason: 'no-usdc-transfer' });
    });

    it('returns no-usdc-transfer when topic[0] is not Transfer', async () => {
      const badLog = {
        address: USDC_ADDR,
        topics: ['0xbadtopic', '0x' + '0'.repeat(64), '0x' + '0'.repeat(64)],
        data: '0x' + '0'.repeat(64),
      };
      mockGetTransactionReceipt.mockResolvedValue(makeReceipt({ status: 1, logs: [badLog] }));
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment(baseInput);
      expect(result).toEqual({ ok: false, reason: 'no-usdc-transfer' });
    });

    it('returns no-usdc-transfer when log has fewer than 3 topics', async () => {
      const shortLog = {
        address: USDC_ADDR,
        topics: [TRANSFER_TOPIC],
        data: '0x' + '0'.repeat(64),
      };
      mockGetTransactionReceipt.mockResolvedValue(makeReceipt({ status: 1, logs: [shortLog] }));
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment(baseInput);
      expect(result).toEqual({ ok: false, reason: 'no-usdc-transfer' });
    });

    it('returns wrong-recipient when to address does not match', async () => {
      const log = makeTransferLog();
      mockGetTransactionReceipt.mockResolvedValue(makeReceipt({ status: 1, logs: [log] }));
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment({
        ...baseInput,
        expectedTo: '0xCompletelyDifferentAddress1234567890ab',
      });
      expect(result).toEqual({ ok: false, reason: 'wrong-recipient' });
    });

    it('returns amount-too-low when transfer amount is less than expected', async () => {
      const log = makeTransferLog({ amount: 100n });
      mockGetTransactionReceipt.mockResolvedValue(makeReceipt({ status: 1, logs: [log] }));
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment({
        ...baseInput,
        expectedAmountWei: 500n,
      });
      expect(result).toEqual({ ok: false, reason: 'amount-too-low' });
    });

    it('returns insufficient-confirmations when below threshold', async () => {
      const log = makeTransferLog({ amount: 1000n });
      mockGetTransactionReceipt.mockResolvedValue(makeReceipt({ status: 1, logs: [log] }));
      const fakeTx = { confirmations: vi.fn().mockResolvedValue(1) };
      mockGetTransaction.mockResolvedValue(fakeTx);
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment({
        ...baseInput,
        expectedAmountWei: 500n,
        minConfirmations: 5,
      });
      expect(result).toEqual({ ok: false, reason: 'insufficient-confirmations' });
    });

    it('returns ok:true with blockNumber on successful verification', async () => {
      const log = makeTransferLog({ amount: 1000n });
      mockGetTransactionReceipt.mockResolvedValue(
        makeReceipt({ status: 1, logs: [log], blockNumber: 99 }),
      );
      const fakeTx = { confirmations: vi.fn().mockResolvedValue(10) };
      mockGetTransaction.mockResolvedValue(fakeTx);
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment({
        ...baseInput,
        expectedAmountWei: 500n,
        minConfirmations: 2,
      });
      expect(result).toEqual({ ok: true, blockNumber: 99 });
    });

    it('accepts exact amount (not just greater)', async () => {
      const log = makeTransferLog({ amount: 500n });
      mockGetTransactionReceipt.mockResolvedValue(
        makeReceipt({ status: 1, logs: [log], blockNumber: 50 }),
      );
      const fakeTx = { confirmations: vi.fn().mockResolvedValue(3) };
      mockGetTransaction.mockResolvedValue(fakeTx);
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment({
        ...baseInput,
        expectedAmountWei: 500n,
        minConfirmations: 2,
      });
      expect(result).toEqual({ ok: true, blockNumber: 50 });
    });

    it('returns ok:true with undefined blockNumber when receipt.blockNumber is null', async () => {
      const log = makeTransferLog({ amount: 1000n });
      mockGetTransactionReceipt.mockResolvedValue(
        makeReceipt({ status: 1, logs: [log], blockNumber: null }),
      );
      const fakeTx = { confirmations: vi.fn().mockResolvedValue(10) };
      mockGetTransaction.mockResolvedValue(fakeTx);
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment({
        ...baseInput,
        expectedAmountWei: 500n,
        minConfirmations: 2,
      });
      expect(result).toEqual({ ok: true, blockNumber: undefined });
    });

    it('_resetBreaker resets the circuit breaker', async () => {
      const { _resetBreaker } = await freshImport();
      expect(() => _resetBreaker()).not.toThrow();
    });

    it('case-insensitive USDC contract address matching', async () => {
      const log = makeTransferLog({ contract: USDC_ADDR.toUpperCase() });
      mockGetTransactionReceipt.mockResolvedValue(
        makeReceipt({ status: 1, logs: [log], blockNumber: 77 }),
      );
      const fakeTx = { confirmations: vi.fn().mockResolvedValue(5) };
      mockGetTransaction.mockResolvedValue(fakeTx);
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment({
        ...baseInput,
        expectedAmountWei: 500n,
        minConfirmations: 2,
      });
      expect(result).toEqual({ ok: true, blockNumber: 77 });
    });
  });
});

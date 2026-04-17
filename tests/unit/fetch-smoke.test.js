import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('scripts/smoke/fetch-smoke.js — step functions', () => {
  let step1_getChallenge, _step2_selfSendUsdc, step3_waitConfirmations, step4_postWithPayment;
  let fetchMock;

  beforeEach(async () => {
    vi.stubEnv('STAGING_URL', 'https://test.example.com');
    vi.stubEnv('API_KEY', 'test-key');
    vi.stubEnv('ACCOUNT_ID', 'test-account');
    vi.stubEnv('FETCH_TARGET_URL', 'https://example.com');
    vi.stubEnv('AWS_REGION', 'us-east-2');
    vi.stubEnv('SECRET_ID', 'test/wallet');
    vi.stubEnv('RPC_SECRET_ID', 'test/rpc');

    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    vi.mock('@aws-sdk/client-secrets-manager', () => ({
      SecretsManagerClient: vi.fn().mockImplementation(() => ({
        send: vi.fn().mockResolvedValue({ SecretString: '{"privateKey":"0xdeadbeef"}' }),
      })),
      GetSecretValueCommand: vi.fn(),
    }));

    vi.mock('ethers', () => {
      const mockWallet = {
        address: '0xAgentAddr',
      };
      const mockContract = {
        transfer: vi.fn().mockResolvedValue({
          hash: '0xtxhash123',
          wait: vi.fn().mockResolvedValue({ blockNumber: 42, status: 1 }),
        }),
      };
      return {
        JsonRpcProvider: vi.fn(),
        Wallet: vi.fn().mockImplementation(() => mockWallet),
        Contract: vi.fn().mockImplementation(() => mockContract),
      };
    });

    const mod = await import('../../scripts/smoke/fetch-smoke.js');
    step1_getChallenge = mod.step1_getChallenge;
    _step2_selfSendUsdc = mod.step2_selfSendUsdc;
    step3_waitConfirmations = mod.step3_waitConfirmations;
    step4_postWithPayment = mod.step4_postWithPayment;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('step1_getChallenge', () => {
    it('returns challenge when API responds 402', async () => {
      fetchMock.mockResolvedValueOnce({
        status: 402,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              challenge: {
                nonce: 'abc123def456',
                payTo: '0xAddr',
                amountWei: '5000',
                chainId: 84532,
              },
            }),
          ),
      });

      const ch = await step1_getChallenge();
      expect(ch.nonce).toBe('abc123def456');
      expect(ch.payTo).toBe('0xAddr');
      expect(ch.amountWei).toBe('5000');
    });

    it('throws when API responds non-402', async () => {
      fetchMock.mockResolvedValueOnce({
        status: 200,
        text: () => Promise.resolve('ok'),
      });

      await expect(step1_getChallenge()).rejects.toThrow('expected 402');
    });

    it('throws when 402 body lacks challenge.nonce', async () => {
      fetchMock.mockResolvedValueOnce({
        status: 402,
        text: () => Promise.resolve(JSON.stringify({ error: 'missing' })),
      });

      await expect(step1_getChallenge()).rejects.toThrow('challenge.nonce');
    });

    it('sends correct headers and body', async () => {
      fetchMock.mockResolvedValueOnce({
        status: 402,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              challenge: { nonce: 'n123456789ab', payTo: '0x1', amountWei: '1', chainId: 1 },
            }),
          ),
      });

      await step1_getChallenge();
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('https://test.example.com/v1/fetch');
      expect(opts.method).toBe('POST');
      expect(opts.headers['content-type']).toBe('application/json');
      expect(opts.headers['x-api-key']).toBe('test-key');
      const body = JSON.parse(opts.body);
      expect(body.url).toBe('https://example.com');
    });

    it('throws on 500 server error', async () => {
      fetchMock.mockResolvedValueOnce({
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      await expect(step1_getChallenge()).rejects.toThrow('expected 402 on first call, got 500');
    });
  });

  describe('step3_waitConfirmations', () => {
    it('returns receipt on success', async () => {
      const mockTx = {
        hash: '0xabc',
        wait: vi.fn().mockResolvedValue({ blockNumber: 100, status: 1 }),
      };
      const receipt = await step3_waitConfirmations(mockTx);
      expect(receipt.blockNumber).toBe(100);
      expect(mockTx.wait).toHaveBeenCalledWith(2);
    });

    it('throws when tx reverts', async () => {
      const mockTx = {
        hash: '0xreverted',
        wait: vi.fn().mockResolvedValue({ blockNumber: 50, status: 0 }),
      };
      await expect(step3_waitConfirmations(mockTx)).rejects.toThrow('tx reverted');
    });
  });

  describe('step4_postWithPayment', () => {
    it('returns parsed fetch result on 200', async () => {
      const challenge = { nonce: 'n1', chainId: 84532 };
      fetchMock.mockResolvedValueOnce({
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              title: 'Example Domain',
              markdown: '# Example Domain',
              metadata: { url: 'https://example.com', contentLength: 1256 },
            }),
          ),
      });

      const result = await step4_postWithPayment(challenge, '0xtx');
      expect(result.title).toBe('Example Domain');
      expect(result.markdown).toContain('Example Domain');
    });

    it('throws when API responds non-200', async () => {
      const challenge = { nonce: 'n1', chainId: 84532 };
      fetchMock.mockResolvedValueOnce({
        status: 403,
        text: () => Promise.resolve('Forbidden'),
      });

      await expect(step4_postWithPayment(challenge, '0xtx')).rejects.toThrow('expected 200');
    });

    it('throws when 200 response has no markdown', async () => {
      const challenge = { nonce: 'n1', chainId: 84532 };
      fetchMock.mockResolvedValueOnce({
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ title: 'Empty' })),
      });

      await expect(step4_postWithPayment(challenge, '0xtx')).rejects.toThrow('missing markdown');
    });

    it('sends X-PAYMENT header with network field', async () => {
      const challenge = { nonce: 'n1', chainId: 84532 };
      fetchMock.mockResolvedValueOnce({
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              title: 'T',
              markdown: '# T',
              metadata: { url: 'https://example.com', contentLength: 10 },
            }),
          ),
      });

      await step4_postWithPayment(challenge, '0xtxhash');
      const [, opts] = fetchMock.mock.calls[0];
      const xPayment = JSON.parse(opts.headers['x-payment']);
      expect(xPayment.nonce).toBe('n1');
      expect(xPayment.txHash).toBe('0xtxhash');
      expect(xPayment.network).toBe('eip155:84532');
    });

    it('sends fetch target URL in body', async () => {
      const challenge = { nonce: 'n1', chainId: 84532 };
      fetchMock.mockResolvedValueOnce({
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              title: 'T',
              markdown: '# T',
              metadata: { contentLength: 5 },
            }),
          ),
      });

      await step4_postWithPayment(challenge, '0xtx');
      const [, opts] = fetchMock.mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.url).toBe('https://example.com');
    });
  });
});

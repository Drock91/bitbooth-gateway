import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockReceipt = { status: 1, blockNumber: 100 };
const mockTx = { hash: '0xabc123', wait: vi.fn().mockResolvedValue(mockReceipt) };
const mockTransfer = vi.fn().mockResolvedValue(mockTx);

vi.mock('ethers', () => ({
  Wallet: vi.fn(function Wallet() {
    this.address = '0xWalletAddress';
  }),
  JsonRpcProvider: vi.fn(function JsonRpcProvider() {}),
  Contract: vi.fn(function Contract() {
    this.transfer = mockTransfer;
  }),
}));

let createX402Client;

beforeEach(async () => {
  vi.resetModules();
  mockTransfer.mockResolvedValue(mockTx);
  mockTx.wait.mockResolvedValue(mockReceipt);
  const mod = await import('../src/x402-client.js');
  createX402Client = mod.createX402Client;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BITBOOTH_AGENT_KEY;
  delete process.env.BITBOOTH_API_URL;
  delete process.env.BITBOOTH_API_KEY;
  delete process.env.BITBOOTH_CHAIN_ID;
  delete process.env.BITBOOTH_RPC_URL;
  delete process.env.BITBOOTH_CONFIRMATIONS;
});

describe('createX402Client', () => {
  it('throws if no agent key provided', () => {
    expect(() => createX402Client()).toThrow('Agent wallet key required');
  });

  it('throws on unsupported chain ID', () => {
    expect(() => createX402Client({ agentKey: '0xkey', chainId: 9999 })).toThrow(
      'Unsupported chain ID: 9999',
    );
  });

  it('creates client with explicit options', () => {
    const client = createX402Client({ agentKey: '0xkey' });
    expect(client.fetchWithPayment).toBeTypeOf('function');
    expect(client.wallet).toBeDefined();
    expect(client.provider).toBeDefined();
  });

  it('reads agent key from env var', () => {
    process.env.BITBOOTH_AGENT_KEY = '0xenvkey';
    const client = createX402Client();
    expect(client.fetchWithPayment).toBeTypeOf('function');
  });

  it('uses custom API URL from env', () => {
    process.env.BITBOOTH_API_URL = 'https://custom.api';
    const client = createX402Client({ agentKey: '0xkey' });
    expect(client).toBeDefined();
  });

  it('accepts custom confirmations option', () => {
    const client = createX402Client({ agentKey: '0xkey', confirmations: 5 });
    expect(client).toBeDefined();
  });
});

describe('fetchWithPayment', () => {
  let client;
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    client = createX402Client({
      agentKey: '0xprivatekey',
      apiUrl: 'https://api.test',
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns immediately on 200 response', async () => {
    const mockResponse = {
      title: 'Test',
      markdown: '# Test',
      metadata: { url: 'https://example.com' },
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await client.fetchWithPayment('https://example.com');
    expect(result).toEqual(mockResponse);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it('handles 402 challenge → pay → retry flow', async () => {
    const challenge = {
      nonce: 'abc123def456',
      payTo: '0xRecipient',
      amountWei: '5000',
      chainId: 8453,
    };

    const fetchResult = { title: 'Paid', markdown: '# Paid content' };

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        status: 402,
        json: () => Promise.resolve({ challenge }),
      })
      .mockResolvedValueOnce({
        status: 200,
        json: () => Promise.resolve(fetchResult),
      });

    const result = await client.fetchWithPayment('https://example.com', 'full');
    expect(result).toEqual(fetchResult);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    const secondCall = globalThis.fetch.mock.calls[1];
    const headers = secondCall[1].headers;
    const payment = JSON.parse(headers['x-payment']);
    expect(payment.nonce).toBe('abc123def456');
    expect(payment.txHash).toBe('0xabc123');
    expect(payment.signature).toBe('langchain-bitbooth');
  });

  it('throws on unexpected status code', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });

    await expect(client.fetchWithPayment('https://example.com')).rejects.toThrow(
      'Unexpected HTTP 500',
    );
  });

  it('throws if 402 response lacks challenge.nonce', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 402,
      json: () => Promise.resolve({ error: 'payment required' }),
    });

    await expect(client.fetchWithPayment('https://example.com')).rejects.toThrow(
      '402 response missing challenge.nonce',
    );
  });

  it('throws if payment tx reverts', async () => {
    const challenge = { nonce: 'n1', payTo: '0xTo', amountWei: '1000' };
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 402,
      json: () => Promise.resolve({ challenge }),
    });

    mockTx.wait.mockResolvedValueOnce({ status: 0 });

    await expect(client.fetchWithPayment('https://example.com')).rejects.toThrow(
      'Payment tx reverted',
    );
  });

  it('throws if post-payment fetch returns non-200', async () => {
    const challenge = { nonce: 'n2', payTo: '0xTo', amountWei: '2000' };

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        status: 402,
        json: () => Promise.resolve({ challenge }),
      })
      .mockResolvedValueOnce({
        status: 403,
        text: () => Promise.resolve('Fraud detected'),
      });

    await expect(client.fetchWithPayment('https://example.com')).rejects.toThrow(
      'Post-payment fetch failed (HTTP 403)',
    );
  });

  it('passes API key header when configured', async () => {
    const clientWithKey = createX402Client({
      agentKey: '0xkey',
      apiUrl: 'https://api.test',
      apiKey: 'x402_mykey',
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ markdown: 'ok' }),
    });

    await clientWithKey.fetchWithPayment('https://example.com');

    const headers = globalThis.fetch.mock.calls[0][1].headers;
    expect(headers['x-api-key']).toBe('x402_mykey');
  });

  it('sends correct body with url and mode', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ markdown: 'ok' }),
    });

    await client.fetchWithPayment('https://example.com/page', 'full');

    const call = globalThis.fetch.mock.calls[0];
    expect(call[0]).toBe('https://api.test/v1/fetch');
    expect(JSON.parse(call[1].body)).toEqual({ url: 'https://example.com/page', mode: 'full' });
  });

  it('defaults mode to fast', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ markdown: 'ok' }),
    });

    await client.fetchWithPayment('https://example.com');

    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.mode).toBe('fast');
  });

  it('sends transfer with correct payTo and amount from challenge', async () => {
    const challenge = { nonce: 'n3', payTo: '0xPayee', amountWei: '7500' };

    mockTransfer.mockClear();

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        status: 402,
        json: () => Promise.resolve({ challenge }),
      })
      .mockResolvedValueOnce({
        status: 200,
        json: () => Promise.resolve({ markdown: 'paid' }),
      });

    await client.fetchWithPayment('https://example.com');

    expect(mockTransfer).toHaveBeenCalledWith('0xPayee', BigInt('7500'));
  });
});

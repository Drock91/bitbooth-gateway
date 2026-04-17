import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('ethers', () => ({
  Wallet: vi.fn(function Wallet() {
    this.address = '0xTest';
  }),
  JsonRpcProvider: vi.fn(function JsonRpcProvider() {}),
  Contract: vi.fn(function Contract() {
    this.transfer = vi.fn();
  }),
}));

vi.mock('../src/x402-client.js', () => ({
  createX402Client: vi.fn().mockReturnValue({
    fetchWithPayment: vi.fn(),
    wallet: { address: '0xTest' },
    provider: {},
  }),
}));

import { createX402Client } from '../src/x402-client.js';
import { createServer } from '../src/server.js';

describe('createServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createX402Client.mockReturnValue({
      fetchWithPayment: vi.fn(),
      wallet: { address: '0xTest' },
      provider: {},
    });
  });

  it('creates an MCP server instance', () => {
    const server = createServer({ agentKey: '0xkey' });
    expect(server).toBeDefined();
    expect(server.connect).toBeTypeOf('function');
  });

  it('passes options to x402 client', () => {
    createServer({ agentKey: '0xkey', apiUrl: 'https://custom.api' });
    expect(createX402Client).toHaveBeenCalledWith({
      agentKey: '0xkey',
      apiUrl: 'https://custom.api',
    });
  });

  it('registers fetch tool on the server', () => {
    const server = createServer({ agentKey: '0xkey' });
    expect(server._registeredTools).toBeDefined();
    expect(server._registeredTools['fetch']).toBeDefined();
    expect(server._registeredTools['fetch'].handler).toBeTypeOf('function');
  });
});

describe('fetch tool handler', () => {
  let mockFetchWithPayment;

  beforeEach(() => {
    mockFetchWithPayment = vi.fn();
    createX402Client.mockReturnValue({
      fetchWithPayment: mockFetchWithPayment,
      wallet: { address: '0xTest' },
      provider: {},
    });
  });

  async function callFetchTool(args) {
    const server = createServer({ agentKey: '0xkey' });
    const tool = server._registeredTools['fetch'];
    return tool.handler(args, {});
  }

  it('returns markdown content on success', async () => {
    mockFetchWithPayment.mockResolvedValue({
      title: 'Example Page',
      markdown: '# Hello World',
      metadata: {
        url: 'https://example.com',
        fetchedAt: '2026-01-01T00:00:00Z',
        contentLength: 1234,
        truncated: false,
      },
    });

    const result = await callFetchTool({ url: 'https://example.com', mode: 'fast' });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('# Example Page');
    expect(result.content[0].text).toContain('# Hello World');
    expect(result.content[0].text).toContain('1234 bytes');
  });

  it('includes truncation notice when content was truncated', async () => {
    mockFetchWithPayment.mockResolvedValue({
      title: '',
      markdown: 'truncated content',
      metadata: {
        url: 'https://big.com',
        fetchedAt: '2026-01-01T00:00:00Z',
        contentLength: 2097152,
        truncated: true,
      },
    });

    const result = await callFetchTool({ url: 'https://big.com', mode: 'fast' });
    expect(result.content[0].text).toContain('truncated');
  });

  it('handles response without title', async () => {
    mockFetchWithPayment.mockResolvedValue({
      title: '',
      markdown: 'raw content',
      metadata: {
        url: 'https://example.com',
        fetchedAt: '2026-01-01T00:00:00Z',
        contentLength: 100,
        truncated: false,
      },
    });

    const result = await callFetchTool({ url: 'https://example.com', mode: 'fast' });
    expect(result.content[0].text).not.toContain('# \n');
    expect(result.content[0].text).toContain('raw content');
  });

  it('handles response without metadata', async () => {
    mockFetchWithPayment.mockResolvedValue({
      title: 'Test',
      markdown: 'content only',
    });

    const result = await callFetchTool({ url: 'https://example.com', mode: 'fast' });
    expect(result.content[0].text).toContain('content only');
    expect(result.content[0].text).not.toContain('Fetched from');
  });

  it('returns error result on failure', async () => {
    mockFetchWithPayment.mockRejectedValue(new Error('Payment failed'));

    const result = await callFetchTool({ url: 'https://example.com', mode: 'fast' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Fetch failed: Payment failed');
  });

  it('passes url and mode to x402 client', async () => {
    mockFetchWithPayment.mockResolvedValue({ markdown: 'ok' });

    await callFetchTool({ url: 'https://example.com/page', mode: 'full' });

    expect(mockFetchWithPayment).toHaveBeenCalledWith('https://example.com/page', 'full');
  });

  it('handles network errors gracefully', async () => {
    mockFetchWithPayment.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await callFetchTool({ url: 'https://down.site', mode: 'fast' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('ECONNREFUSED');
  });
});

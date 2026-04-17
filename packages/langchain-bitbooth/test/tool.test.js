import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('ethers', () => ({
  Wallet: vi.fn(function Wallet() {
    this.address = '0xWalletAddress';
  }),
  JsonRpcProvider: vi.fn(function JsonRpcProvider() {}),
  Contract: vi.fn(function Contract() {
    this.transfer = vi.fn();
  }),
}));

const { createBitBoothFetchTool, BitBoothFetchSchema } = await import('../src/tool.js');

function makeFakeClient(fetchWithPaymentImpl) {
  return {
    fetchWithPayment: vi.fn(fetchWithPaymentImpl),
    wallet: {},
    provider: {},
  };
}

describe('BitBoothFetchSchema', () => {
  it('accepts valid url with default mode', () => {
    const parsed = BitBoothFetchSchema.parse({ url: 'https://example.com' });
    expect(parsed.url).toBe('https://example.com');
    expect(parsed.mode).toBe('fast');
  });

  it('accepts explicit mode=full', () => {
    const parsed = BitBoothFetchSchema.parse({ url: 'https://example.com', mode: 'full' });
    expect(parsed.mode).toBe('full');
  });

  it('rejects non-URL strings', () => {
    expect(() => BitBoothFetchSchema.parse({ url: 'not-a-url' })).toThrow();
  });

  it('rejects unknown mode', () => {
    expect(() =>
      BitBoothFetchSchema.parse({ url: 'https://example.com', mode: 'medium' }),
    ).toThrow();
  });

  it('rejects missing url', () => {
    expect(() => BitBoothFetchSchema.parse({ mode: 'fast' })).toThrow();
  });
});

describe('createBitBoothFetchTool', () => {
  let client;

  beforeEach(() => {
    client = makeFakeClient(async (url, mode) => ({
      title: 'Example',
      markdown: `Content for ${url} in ${mode}`,
      metadata: {
        url,
        fetchedAt: '2026-04-16T00:00:00Z',
        contentLength: 1234,
        truncated: false,
      },
    }));
  });

  it('returns a LangChain tool with default name and description', () => {
    const t = createBitBoothFetchTool({ client });
    expect(t.name).toBe('bitbooth_fetch');
    expect(t.description).toContain('markdown');
    expect(t.description).toContain('x402');
  });

  it('allows overriding name and description', () => {
    const t = createBitBoothFetchTool({
      client,
      name: 'scrape_web',
      description: 'custom desc',
    });
    expect(t.name).toBe('scrape_web');
    expect(t.description).toBe('custom desc');
  });

  it('invokes client.fetchWithPayment with url and mode', async () => {
    const t = createBitBoothFetchTool({ client });
    const output = await t.invoke({ url: 'https://example.com', mode: 'full' });
    expect(client.fetchWithPayment).toHaveBeenCalledWith('https://example.com', 'full');
    expect(output).toContain('# Example');
    expect(output).toContain('Content for https://example.com in full');
    expect(output).toContain('1234 bytes');
    expect(output).toContain('_Fetched from https://example.com');
  });

  it('defaults mode to fast when omitted', async () => {
    const t = createBitBoothFetchTool({ client });
    await t.invoke({ url: 'https://example.com' });
    expect(client.fetchWithPayment).toHaveBeenCalledWith('https://example.com', 'fast');
  });

  it('marks truncated results in the footer', async () => {
    const truncatedClient = makeFakeClient(async () => ({
      title: 'Big',
      markdown: 'lots',
      metadata: {
        url: 'https://example.com',
        fetchedAt: '2026-04-16T00:00:00Z',
        contentLength: 999999,
        truncated: true,
      },
    }));
    const t = createBitBoothFetchTool({ client: truncatedClient });
    const output = await t.invoke({ url: 'https://example.com' });
    expect(output).toContain('truncated');
  });

  it('handles result without title', async () => {
    const noTitleClient = makeFakeClient(async () => ({
      markdown: 'just markdown',
      metadata: { url: 'https://example.com' },
    }));
    const t = createBitBoothFetchTool({ client: noTitleClient });
    const output = await t.invoke({ url: 'https://example.com' });
    expect(output).not.toMatch(/^#/);
    expect(output).toContain('just markdown');
  });

  it('handles result without metadata', async () => {
    const noMetaClient = makeFakeClient(async () => ({
      title: 'T',
      markdown: 'body',
    }));
    const t = createBitBoothFetchTool({ client: noMetaClient });
    const output = await t.invoke({ url: 'https://example.com' });
    expect(output).toContain('# T');
    expect(output).toContain('body');
    expect(output).not.toContain('_Fetched from');
  });

  it('handles unknown content length in metadata', async () => {
    const unknownSizeClient = makeFakeClient(async () => ({
      markdown: 'body',
      metadata: { url: 'https://example.com', fetchedAt: '2026-04-16T00:00:00Z' },
    }));
    const t = createBitBoothFetchTool({ client: unknownSizeClient });
    const output = await t.invoke({ url: 'https://example.com' });
    expect(output).toContain('unknown size');
  });

  it('propagates errors from client', async () => {
    const failClient = makeFakeClient(async () => {
      throw new Error('payment failed');
    });
    const t = createBitBoothFetchTool({ client: failClient });
    await expect(t.invoke({ url: 'https://example.com' })).rejects.toThrow('payment failed');
  });

  it('rejects invalid url input via zod schema', async () => {
    const t = createBitBoothFetchTool({ client });
    await expect(t.invoke({ url: 'not-a-url' })).rejects.toThrow();
  });

  it('builds a real client when none is provided', () => {
    const t = createBitBoothFetchTool({ agentKey: '0xkey' });
    expect(t.name).toBe('bitbooth_fetch');
  });

  it('exposes the Zod schema on the tool', () => {
    const t = createBitBoothFetchTool({ client });
    expect(t.schema).toBeDefined();
  });
});

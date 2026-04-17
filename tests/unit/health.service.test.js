import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockSend, mockGetSecret } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockGetSecret: vi.fn(),
}));
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {
    constructor() {
      this.send = mockSend;
    }
  },
  DescribeTableCommand: vi.fn(function (params) {
    Object.assign(this, { input: params });
  }),
}));

vi.mock('../../src/lib/secrets.js', () => ({
  getSecret: (...args) => mockGetSecret(...args),
}));

vi.mock('../../src/lib/config.js', () => ({
  getConfig: () => ({
    awsRegion: 'us-east-1',
    stage: 'dev',
    chain: { rpcUrl: 'https://rpc.example.com', chainId: 8453 },
    secretArns: { agentWallet: 'arn:aws:secretsmanager:us-east-1:123:secret:wallet' },
  }),
}));

describe('health.service', () => {
  let checkReady;
  let originalFetch;

  beforeEach(async () => {
    vi.resetModules();
    mockSend.mockReset();
    mockGetSecret.mockReset();
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();

    const mod = await import('../../src/services/health.service.js');
    checkReady = mod.checkReady;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns ok:true when all checks pass', async () => {
    mockSend.mockResolvedValue({});
    mockGetSecret.mockResolvedValue('secret-value');
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: '2.0', result: '0x1a2b3c', id: 1 }),
    });

    const result = await checkReady();

    expect(result.ok).toBe(true);
    expect(result.stage).toBe('dev');
    expect(result.checks).toHaveLength(3);
    expect(result.checks.every((c) => c.ok)).toBe(true);
  });

  it('returns ok:false when DDB fails', async () => {
    mockSend.mockRejectedValue(new Error('DDB unreachable'));
    mockGetSecret.mockResolvedValue('secret-value');
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: '2.0', result: '0x1', id: 1 }),
    });

    const result = await checkReady();

    expect(result.ok).toBe(false);
    const ddb = result.checks.find((c) => c.name === 'dynamodb');
    expect(ddb.ok).toBe(false);
    expect(ddb.error).toBe('DDB unreachable');
  });

  it('returns ok:false when secrets fail', async () => {
    mockSend.mockResolvedValue({});
    mockGetSecret.mockRejectedValue(new Error('Access denied'));
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: '2.0', result: '0x1', id: 1 }),
    });

    const result = await checkReady();

    expect(result.ok).toBe(false);
    const secrets = result.checks.find((c) => c.name === 'secrets');
    expect(secrets.ok).toBe(false);
    expect(secrets.error).toBe('Access denied');
  });

  it('returns ok:false when chain RPC returns HTTP error', async () => {
    mockSend.mockResolvedValue({});
    mockGetSecret.mockResolvedValue('secret-value');
    globalThis.fetch.mockResolvedValue({ ok: false, status: 502 });

    const result = await checkReady();

    expect(result.ok).toBe(false);
    const chain = result.checks.find((c) => c.name === 'chain_rpc');
    expect(chain.ok).toBe(false);
    expect(chain.error).toBe('HTTP 502');
  });

  it('returns ok:false when chain RPC returns JSON-RPC error', async () => {
    mockSend.mockResolvedValue({});
    mockGetSecret.mockResolvedValue('secret-value');
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'rate limited' },
          id: 1,
        }),
    });

    const result = await checkReady();

    expect(result.ok).toBe(false);
    const chain = result.checks.find((c) => c.name === 'chain_rpc');
    expect(chain.ok).toBe(false);
    expect(chain.error).toBe('rate limited');
  });

  it('returns ok:false when fetch throws (network error)', async () => {
    mockSend.mockResolvedValue({});
    mockGetSecret.mockResolvedValue('secret-value');
    globalThis.fetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await checkReady();

    expect(result.ok).toBe(false);
    const chain = result.checks.find((c) => c.name === 'chain_rpc');
    expect(chain.ok).toBe(false);
    expect(chain.error).toBe('ECONNREFUSED');
  });

  it('returns ok:false when all checks fail', async () => {
    mockSend.mockRejectedValue(new Error('DDB down'));
    mockGetSecret.mockRejectedValue(new Error('Secret gone'));
    globalThis.fetch.mockRejectedValue(new Error('Network down'));

    const result = await checkReady();

    expect(result.ok).toBe(false);
    expect(result.checks.every((c) => !c.ok)).toBe(true);
  });

  it('includes latencyMs on all checks', async () => {
    mockSend.mockResolvedValue({});
    mockGetSecret.mockResolvedValue('ok');
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: '2.0', result: '0x1', id: 1 }),
    });

    const result = await checkReady();

    for (const check of result.checks) {
      expect(typeof check.latencyMs).toBe('number');
      expect(check.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('runs all checks concurrently', async () => {
    const order = [];
    mockSend.mockImplementation(async () => {
      order.push('ddb-start');
      await new Promise((r) => setTimeout(r, 10));
      order.push('ddb-end');
    });
    mockGetSecret.mockImplementation(async () => {
      order.push('secrets-start');
      await new Promise((r) => setTimeout(r, 10));
      order.push('secrets-end');
      return 'val';
    });
    globalThis.fetch.mockImplementation(async () => {
      order.push('rpc-start');
      await new Promise((r) => setTimeout(r, 10));
      order.push('rpc-end');
      return { ok: true, json: () => Promise.resolve({ jsonrpc: '2.0', result: '0x1', id: 1 }) };
    });

    await checkReady();

    const starts = order.filter((e) => e.endsWith('-start'));
    const firstEnd = order.findIndex((e) => e.endsWith('-end'));
    expect(starts.length).toBe(3);
    expect(firstEnd).toBeGreaterThanOrEqual(starts.length);
  });

  it('check names are dynamodb, secrets, chain_rpc', async () => {
    mockSend.mockResolvedValue({});
    mockGetSecret.mockResolvedValue('ok');
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: '2.0', result: '0x1', id: 1 }),
    });

    const result = await checkReady();
    const names = result.checks.map((c) => c.name).sort();
    expect(names).toEqual(['chain_rpc', 'dynamodb', 'secrets']);
  });
});

describe('health.service — no RPC URL configured', () => {
  let checkReady;

  beforeEach(async () => {
    vi.resetModules();
    mockSend.mockReset();
    mockGetSecret.mockReset();

    vi.doMock('../../src/lib/config.js', () => ({
      getConfig: () => ({
        awsRegion: 'us-east-1',
        stage: 'dev',
        chain: { chainId: 8453 },
        secretArns: { agentWallet: 'arn:wallet' },
      }),
    }));

    const mod = await import('../../src/services/health.service.js');
    checkReady = mod.checkReady;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns chain_rpc failure when no RPC URL is configured', async () => {
    mockSend.mockResolvedValue({});
    mockGetSecret.mockResolvedValue('ok');

    const result = await checkReady();

    const chain = result.checks.find((c) => c.name === 'chain_rpc');
    expect(chain.ok).toBe(false);
    expect(chain.error).toContain('no RPC URL configured');
  });
});

describe('health.service — baseRpc secret ARN', () => {
  let checkReady;
  let originalFetch;

  beforeEach(async () => {
    vi.resetModules();
    mockSend.mockReset();
    mockGetSecret.mockReset();
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();

    vi.doMock('../../src/lib/config.js', () => ({
      getConfig: () => ({
        awsRegion: 'us-east-1',
        stage: 'dev',
        chain: { chainId: 8453 },
        secretArns: {
          agentWallet: 'arn:wallet',
          baseRpc: 'arn:aws:secretsmanager:us-east-1:123:secret:base-rpc',
        },
      }),
    }));

    const mod = await import('../../src/services/health.service.js');
    checkReady = mod.checkReady;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('fetches RPC URL from secrets when baseRpc ARN is configured', async () => {
    mockSend.mockResolvedValue({});
    mockGetSecret.mockResolvedValue('https://secret-rpc.example.com');
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: '2.0', result: '0x1', id: 1 }),
    });

    const result = await checkReady();

    expect(mockGetSecret).toHaveBeenCalledWith(
      'arn:aws:secretsmanager:us-east-1:123:secret:base-rpc',
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://secret-rpc.example.com',
      expect.objectContaining({ method: 'POST' }),
    );
    const chain = result.checks.find((c) => c.name === 'chain_rpc');
    expect(chain.ok).toBe(true);
  });

  it('returns chain_rpc failure when secret fetch fails', async () => {
    mockSend.mockResolvedValue({});
    mockGetSecret.mockImplementation(async (arn) => {
      if (arn.includes('base-rpc')) throw new Error('secret not found');
      return 'ok';
    });

    const result = await checkReady();

    const chain = result.checks.find((c) => c.name === 'chain_rpc');
    expect(chain.ok).toBe(false);
    expect(chain.error).toBe('secret not found');
  });
});

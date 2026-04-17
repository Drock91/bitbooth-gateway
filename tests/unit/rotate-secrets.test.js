import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: function () {
    return { send: mockSend };
  },
  UpdateSecretCommand: function (params) {
    Object.assign(this, { _type: 'Update', ...params });
  },
  GetSecretValueCommand: function (params) {
    Object.assign(this, { _type: 'Get', ...params });
  },
}));

vi.mock('node:crypto', async () => {
  const actual = await vi.importActual('node:crypto');
  return {
    ...actual,
    randomBytes: vi.fn((n) => Buffer.alloc(n, 0xab)),
  };
});

let run;
let logLines;
let errorLines;
let exitCode;
let origExit;

function makeArgv(args) {
  return ['node', 'rotate-secrets.js', ...args];
}

function deps() {
  return {
    client: { send: mockSend },
    log: (msg) => logLines.push(msg),
    logError: (msg) => errorLines.push(msg),
  };
}

describe('scripts/rotate-secrets.js', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockSend.mockReset();
    logLines = [];
    errorLines = [];
    exitCode = null;
    origExit = process.exit;
    process.exit = vi.fn((code) => {
      exitCode = code;
      throw new Error(`process.exit(${code})`);
    });
    ({ run } = await import('../../scripts/rotate-secrets.js'));
  });

  afterEach(() => {
    process.exit = origExit;
  });

  describe('argument parsing', () => {
    it('exits 1 when --stage is missing', async () => {
      await expect(run(makeArgv([]), deps())).rejects.toThrow('process.exit(1)');
      expect(exitCode).toBe(1);
    });

    it('exits 1 for invalid stage', async () => {
      await expect(run(makeArgv(['--stage=dev']), deps())).rejects.toThrow('process.exit(1)');
      expect(exitCode).toBe(1);
    });

    it('accepts staging stage', async () => {
      const results = await run(makeArgv(['--stage=staging']), deps());
      expect(results).toHaveLength(9);
    });

    it('accepts prod stage', async () => {
      const results = await run(makeArgv(['--stage=prod']), deps());
      expect(results).toHaveLength(9);
    });
  });

  describe('dry-run mode (default)', () => {
    it('does not call AWS when --execute is absent', async () => {
      const results = await run(makeArgv(['--stage=staging']), deps());
      expect(mockSend).not.toHaveBeenCalled();
      expect(results.every((r) => r.status === 'would-rotate')).toBe(true);
    });

    it('lists all 9 secrets', async () => {
      const results = await run(makeArgv(['--stage=staging']), deps());
      expect(results).toHaveLength(9);
      const ids = results.map((r) => r.secretId);
      expect(ids).toContain('x402/staging/agent-wallet');
      expect(ids).toContain('x402/staging/stripe-webhook');
      expect(ids).toContain('x402/staging/base-rpc');
      expect(ids).toContain('x402/staging/admin-api-key-hash');
      expect(ids).toContain('x402/staging/exchanges/moonpay');
      expect(ids).toContain('x402/staging/exchanges/coinbase');
      expect(ids).toContain('x402/staging/exchanges/kraken');
      expect(ids).toContain('x402/staging/exchanges/binance');
      expect(ids).toContain('x402/staging/exchanges/uphold');
    });

    it('uses prod prefix when stage=prod', async () => {
      const results = await run(makeArgv(['--stage=prod']), deps());
      expect(results[0].secretId).toBe('x402/prod/agent-wallet');
    });

    it('logs dry-run summary', async () => {
      await run(makeArgv(['--stage=staging']), deps());
      expect(logLines.some((l) => l.includes('dry-run complete'))).toBe(true);
      expect(logLines.some((l) => l.includes('9 entries would be rotated'))).toBe(true);
    });

    it('logs re-run hint', async () => {
      await run(makeArgv(['--stage=staging']), deps());
      expect(logLines.some((l) => l.includes('--execute'))).toBe(true);
    });
  });

  describe('execute mode', () => {
    beforeEach(() => {
      mockSend.mockResolvedValue({});
    });

    it('calls GetSecretValue to verify existence before updating', async () => {
      await run(makeArgv(['--stage=staging', '--execute']), deps());
      const getCalls = mockSend.mock.calls.filter((c) => c[0]._type === 'Get');
      expect(getCalls).toHaveLength(9);
    });

    it('calls UpdateSecret for each existing secret', async () => {
      await run(makeArgv(['--stage=staging', '--execute']), deps());
      const updateCalls = mockSend.mock.calls.filter((c) => c[0]._type === 'Update');
      expect(updateCalls).toHaveLength(9);
    });

    it('reports all 9 as rotated on success', async () => {
      const results = await run(makeArgv(['--stage=staging', '--execute']), deps());
      expect(results.filter((r) => r.status === 'rotated')).toHaveLength(9);
    });

    it('logs success checkmark for each rotated secret', async () => {
      await run(makeArgv(['--stage=staging', '--execute']), deps());
      const checkLines = logLines.filter((l) => l.includes('✓'));
      expect(checkLines).toHaveLength(9);
    });

    it('logs done summary with counts', async () => {
      await run(makeArgv(['--stage=staging', '--execute']), deps());
      expect(logLines.some((l) => l.includes('9 rotated, 0 skipped, 0 errors'))).toBe(true);
    });
  });

  describe('secret value generation', () => {
    beforeEach(() => {
      mockSend.mockResolvedValue({});
    });

    it('generates valid JSON for agent-wallet with hex private key', async () => {
      await run(makeArgv(['--stage=staging', '--execute']), deps());
      const walletUpdate = mockSend.mock.calls.find(
        (c) => c[0]._type === 'Update' && c[0].SecretId === 'x402/staging/agent-wallet',
      );
      const parsed = JSON.parse(walletUpdate[0].SecretString);
      expect(parsed.privateKey).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('generates valid JSON for stripe-webhook with whsec_ prefix', async () => {
      await run(makeArgv(['--stage=staging', '--execute']), deps());
      const update = mockSend.mock.calls.find(
        (c) => c[0]._type === 'Update' && c[0].SecretId === 'x402/staging/stripe-webhook',
      );
      const parsed = JSON.parse(update[0].SecretString);
      expect(parsed.webhookSecret).toMatch(/^whsec_/);
    });

    it('generates URL string for base-rpc', async () => {
      await run(makeArgv(['--stage=staging', '--execute']), deps());
      const update = mockSend.mock.calls.find(
        (c) => c[0]._type === 'Update' && c[0].SecretId === 'x402/staging/base-rpc',
      );
      expect(update[0].SecretString).toMatch(/^https:\/\/mainnet\.base\.org\//);
    });

    it('stores SHA-256 hash (not raw key) for admin-api-key-hash', async () => {
      await run(makeArgv(['--stage=staging', '--execute']), deps());
      const update = mockSend.mock.calls.find(
        (c) => c[0]._type === 'Update' && c[0].SecretId === 'x402/staging/admin-api-key-hash',
      );
      expect(update[0].SecretString).toMatch(/^[0-9a-f]{64}$/);
    });

    it('prints raw admin key once for operator to save', async () => {
      await run(makeArgv(['--stage=staging', '--execute']), deps());
      expect(logLines.some((l) => l.includes('SAVE THESE RAW KEYS'))).toBe(true);
      expect(logLines.some((l) => l.includes('admin-api-key-hash:'))).toBe(true);
    });

    it('generates valid JSON for exchange secrets with apiKey and webhookSecret', async () => {
      await run(makeArgv(['--stage=staging', '--execute']), deps());
      for (const name of ['moonpay', 'coinbase', 'kraken', 'binance', 'uphold']) {
        const update = mockSend.mock.calls.find(
          (c) => c[0]._type === 'Update' && c[0].SecretId === `x402/staging/exchanges/${name}`,
        );
        const parsed = JSON.parse(update[0].SecretString);
        expect(parsed).toHaveProperty('apiKey');
        expect(parsed).toHaveProperty('webhookSecret');
        expect(parsed.apiKey.length).toBeGreaterThan(0);
        expect(parsed.webhookSecret.length).toBeGreaterThan(0);
      }
    });
  });

  describe('error handling', () => {
    it('skips secrets that do not exist (ResourceNotFoundException)', async () => {
      mockSend.mockImplementation((cmd) => {
        if (cmd._type === 'Get') {
          const err = new Error('not found');
          err.name = 'ResourceNotFoundException';
          throw err;
        }
        return {};
      });

      const results = await run(makeArgv(['--stage=staging', '--execute']), deps());
      expect(results.every((r) => r.status === 'not-found')).toBe(true);
      expect(errorLines.some((l) => l.includes('SKIP'))).toBe(true);
    });

    it('re-throws unexpected GetSecretValue errors', async () => {
      mockSend.mockImplementation((cmd) => {
        if (cmd._type === 'Get') throw new Error('network failure');
        return {};
      });

      await expect(run(makeArgv(['--stage=staging', '--execute']), deps())).rejects.toThrow(
        'network failure',
      );
    });

    it('records error status on UpdateSecret failure', async () => {
      let callCount = 0;
      mockSend.mockImplementation((cmd) => {
        if (cmd._type === 'Update') {
          callCount++;
          if (callCount === 1) throw new Error('access denied');
        }
        return {};
      });

      await expect(run(makeArgv(['--stage=staging', '--execute']), deps())).rejects.toThrow(
        'process.exit(1)',
      );
      expect(errorLines.some((l) => l.includes('access denied'))).toBe(true);
    });

    it('exits 1 when any rotation errors occur', async () => {
      mockSend.mockImplementation((cmd) => {
        if (cmd._type === 'Update' && cmd.SecretId.includes('agent-wallet')) {
          throw new Error('throttled');
        }
        return {};
      });

      await expect(run(makeArgv(['--stage=staging', '--execute']), deps())).rejects.toThrow(
        'process.exit(1)',
      );
      expect(exitCode).toBe(1);
    });
  });

  describe('prod stage', () => {
    beforeEach(() => {
      mockSend.mockResolvedValue({});
    });

    it('uses x402/prod/ prefix for all secrets', async () => {
      const results = await run(makeArgv(['--stage=prod', '--execute']), deps());
      expect(results.every((r) => r.secretId.startsWith('x402/prod/'))).toBe(true);
    });

    it('rotates all 9 prod secrets successfully', async () => {
      const results = await run(makeArgv(['--stage=prod', '--execute']), deps());
      expect(results.filter((r) => r.status === 'rotated')).toHaveLength(9);
    });
  });

  describe('mixed results', () => {
    it('reports correct counts with mixed success/skip/error', async () => {
      let getCount = 0;
      let updateCount = 0;
      mockSend.mockImplementation((cmd) => {
        if (cmd._type === 'Get') {
          getCount++;
          if (getCount === 2) {
            const err = new Error('not found');
            err.name = 'ResourceNotFoundException';
            throw err;
          }
        }
        if (cmd._type === 'Update') {
          updateCount++;
          if (updateCount === 3) throw new Error('boom');
        }
        return {};
      });

      await expect(run(makeArgv(['--stage=staging', '--execute']), deps())).rejects.toThrow(
        'process.exit(1)',
      );

      const rotated = logLines.filter((l) => l.includes('✓')).length;
      const skipped = errorLines.filter((l) => l.includes('SKIP')).length;
      const errors = errorLines.filter((l) => l.includes('✗')).length;
      expect(rotated).toBeGreaterThan(0);
      expect(skipped).toBe(1);
      expect(errors).toBe(1);
    });
  });

  describe('header logging', () => {
    it('logs stage and mode in header', async () => {
      await run(makeArgv(['--stage=staging']), deps());
      expect(logLines[0]).toContain('staging');
      expect(logLines[0]).toContain('DRY-RUN');
    });

    it('logs EXECUTE mode when --execute is passed', async () => {
      mockSend.mockResolvedValue({});
      await run(makeArgv(['--stage=prod', '--execute']), deps());
      expect(logLines[0]).toContain('EXECUTE');
    });

    it('logs entry count', async () => {
      await run(makeArgv(['--stage=staging']), deps());
      expect(logLines[1]).toContain('9');
    });
  });
});

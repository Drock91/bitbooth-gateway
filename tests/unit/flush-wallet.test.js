import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSmSend = vi.fn();
const mockDdbSend = vi.fn();

vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: function () {
    return { send: mockSmSend };
  },
  GetSecretValueCommand: function (params) {
    Object.assign(this, { _type: 'GetSecret', ...params });
  },
  UpdateSecretCommand: function (params) {
    Object.assign(this, { _type: 'UpdateSecret', ...params });
  },
  CreateSecretCommand: function (params) {
    Object.assign(this, { _type: 'CreateSecret', ...params });
  },
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: function () {
    return {};
  },
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockDdbSend }) },
  PutCommand: function (params) {
    Object.assign(this, { _type: 'Put', ...params });
  },
}));

vi.mock('ethers', () => ({
  Wallet: function (pk) {
    this.address = `0xADDR_${pk.slice(2, 10)}`;
    this.connect = () => ({
      address: this.address,
      sendTransaction: vi.fn().mockResolvedValue({
        wait: vi.fn().mockResolvedValue({ hash: '0xNATIVE_TX' }),
      }),
    });
  },
  JsonRpcProvider: function () {},
  Contract: function () {},
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

const OLD_KEY = '0x1111111111111111111111111111111111111111111111111111111111111111';
const OLD_SECRET = JSON.stringify({ privateKey: OLD_KEY });

function argv(...args) {
  return ['node', 'flush-wallet.js', ...args];
}

function makeMockProvider() {
  return {
    getBalance: vi.fn().mockResolvedValue(500000n),
    getFeeData: vi.fn().mockResolvedValue({ gasPrice: 10n }),
  };
}

function makeMockUsdcContract() {
  return {
    balanceOf: vi.fn().mockResolvedValue(1000000n),
    transfer: vi.fn().mockResolvedValue({
      wait: vi.fn().mockResolvedValue({ hash: '0xUSDC_TX' }),
    }),
  };
}

function makeDeps(overrides = {}) {
  return {
    smClient: { send: mockSmSend },
    log: (msg) => logLines.push(msg),
    logError: (msg) => errorLines.push(msg),
    provider: makeMockProvider(),
    usdcContract: makeMockUsdcContract(),
    oldSigner: {
      address: `0xADDR_${OLD_KEY.slice(2, 10)}`,
      sendTransaction: vi.fn().mockResolvedValue({
        wait: vi.fn().mockResolvedValue({ hash: '0xNATIVE_TX' }),
      }),
    },
    ddbClient: { send: mockDdbSend },
    createWallet: (pk) => ({
      address: `0xADDR_${pk.slice(2, 10)}`,
      connect: () => ({
        address: `0xADDR_${pk.slice(2, 10)}`,
        sendTransaction: vi.fn().mockResolvedValue({
          wait: vi.fn().mockResolvedValue({ hash: '0xNATIVE_TX' }),
        }),
      }),
    }),
    ...overrides,
  };
}

describe('scripts/ops/flush-wallet.js', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockSmSend.mockReset();
    mockDdbSend.mockReset();
    logLines = [];
    errorLines = [];
    exitCode = null;
    origExit = process.exit;
    process.exit = vi.fn((code) => {
      exitCode = code;
      throw new Error(`process.exit(${code})`);
    });
    ({ run } = await import('../../scripts/ops/flush-wallet.js'));
  });

  afterEach(() => {
    process.exit = origExit;
  });

  describe('argument parsing', () => {
    it('exits 1 when --stage is missing', async () => {
      await expect(run(argv(), makeDeps())).rejects.toThrow('process.exit(1)');
      expect(exitCode).toBe(1);
    });

    it('exits 1 for invalid stage', async () => {
      await expect(run(argv('--stage=dev'), makeDeps())).rejects.toThrow('process.exit(1)');
    });

    it('accepts staging stage', async () => {
      const audit = await run(argv('--stage=staging'), makeDeps());
      expect(audit.stage).toBe('staging');
    });

    it('accepts prod stage', async () => {
      const audit = await run(argv('--stage=prod'), makeDeps());
      expect(audit.stage).toBe('prod');
    });
  });

  describe('dry-run mode (default)', () => {
    it('does not call AWS when --execute is absent', async () => {
      await run(argv('--stage=staging'), makeDeps());
      expect(mockSmSend).not.toHaveBeenCalled();
    });

    it('logs the 9-step plan', async () => {
      await run(argv('--stage=staging'), makeDeps());
      expect(logLines.some((l) => l.includes('Load old wallet'))).toBe(true);
      expect(logLines.some((l) => l.includes('Generate new wallet'))).toBe(true);
      expect(logLines.some((l) => l.includes('Archive old key'))).toBe(true);
      expect(logLines.some((l) => l.includes('Initialize nonce'))).toBe(true);
    });

    it('logs dry-run complete message', async () => {
      await run(argv('--stage=staging'), makeDeps());
      expect(logLines.some((l) => l.includes('dry-run complete'))).toBe(true);
    });

    it('returns audit with dry-run mode', async () => {
      const audit = await run(argv('--stage=staging'), makeDeps());
      expect(audit.mode).toBe('dry-run');
    });

    it('uses correct secret path for prod', async () => {
      await run(argv('--stage=prod'), makeDeps());
      expect(logLines.some((l) => l.includes('x402/prod/agent-wallet'))).toBe(true);
    });
  });

  describe('execute mode — happy path', () => {
    beforeEach(() => {
      mockSmSend.mockImplementation((cmd) => {
        if (cmd._type === 'GetSecret') return { SecretString: OLD_SECRET };
        return {};
      });
      mockDdbSend.mockResolvedValue({});
    });

    it('loads old wallet from Secrets Manager', async () => {
      await run(argv('--stage=staging', '--execute'), makeDeps());
      const getCalls = mockSmSend.mock.calls.filter((c) => c[0]._type === 'GetSecret');
      expect(getCalls.length).toBeGreaterThanOrEqual(1);
      expect(getCalls[0][0].SecretId).toBe('x402/staging/agent-wallet');
    });

    it('generates new wallet and logs addresses', async () => {
      const audit = await run(argv('--stage=staging', '--execute'), makeDeps());
      expect(logLines.some((l) => l.includes('generate-new-wallet'))).toBe(true);
      expect(audit.summary.oldAddress).toBeDefined();
      expect(audit.summary.newAddress).toBeDefined();
      expect(audit.summary.oldAddress).not.toBe(audit.summary.newAddress);
    });

    it('queries USDC and native balances', async () => {
      const deps = makeDeps();
      await run(argv('--stage=staging', '--execute'), deps);
      expect(deps.usdcContract.balanceOf).toHaveBeenCalled();
      expect(deps.provider.getBalance).toHaveBeenCalled();
    });

    it('transfers USDC when balance > 0', async () => {
      const deps = makeDeps();
      await run(argv('--stage=staging', '--execute'), deps);
      expect(deps.usdcContract.transfer).toHaveBeenCalled();
      expect(logLines.some((l) => l.includes('transfer-usdc') && l.includes('✓'))).toBe(true);
    });

    it('transfers native gas when balance > gas cost', async () => {
      const deps = makeDeps();
      await run(argv('--stage=staging', '--execute'), deps);
      expect(deps.oldSigner.sendTransaction).toHaveBeenCalled();
      expect(logLines.some((l) => l.includes('transfer-native') && l.includes('✓'))).toBe(true);
    });

    it('archives old key to Secrets Manager with metadata', async () => {
      await run(argv('--stage=staging', '--execute'), makeDeps());
      const creates = mockSmSend.mock.calls.filter((c) => c[0]._type === 'CreateSecret');
      expect(creates).toHaveLength(1);
      expect(creates[0][0].Name).toMatch(/x402\/staging\/agent-wallet-archive-/);
      const payload = JSON.parse(creates[0][0].SecretString);
      expect(payload.privateKey).toBe(OLD_KEY);
      expect(payload.archivedAt).toBeDefined();
      expect(payload.replacedBy).toBeDefined();
    });

    it('updates wallet secret with new private key', async () => {
      await run(argv('--stage=staging', '--execute'), makeDeps());
      const updates = mockSmSend.mock.calls.filter((c) => c[0]._type === 'UpdateSecret');
      expect(updates).toHaveLength(1);
      expect(updates[0][0].SecretId).toBe('x402/staging/agent-wallet');
      const parsed = JSON.parse(updates[0][0].SecretString);
      expect(parsed.privateKey).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('initializes nonce in DDB for new wallet', async () => {
      await run(argv('--stage=staging', '--execute'), makeDeps());
      expect(mockDdbSend).toHaveBeenCalled();
      const putCall = mockDdbSend.mock.calls[0][0];
      expect(putCall.Item.currentNonce).toBe(0);
      expect(putCall.Item.walletAddress).toBeDefined();
    });

    it('returns audit with summary', async () => {
      const audit = await run(argv('--stage=staging', '--execute'), makeDeps());
      expect(audit.exitCode).toBe(0);
      expect(audit.summary.archiveSecretId).toMatch(/archive/);
      expect(audit.summary.usdcDrained).toBe('1000000');
      expect(audit.summary.nativeDrained).toBe('500000');
    });

    it('prints audit log as JSON', async () => {
      await run(argv('--stage=staging', '--execute'), makeDeps());
      expect(logLines.some((l) => l.includes('AUDIT LOG'))).toBe(true);
    });

    it('prints new wallet address at end', async () => {
      await run(argv('--stage=staging', '--execute'), makeDeps());
      expect(logLines.some((l) => l.includes('new wallet address'))).toBe(true);
    });
  });

  describe('execute mode — zero balances', () => {
    beforeEach(() => {
      mockSmSend.mockImplementation((cmd) => {
        if (cmd._type === 'GetSecret') return { SecretString: OLD_SECRET };
        return {};
      });
      mockDdbSend.mockResolvedValue({});
    });

    it('skips USDC transfer when balance is zero', async () => {
      const deps = makeDeps({
        usdcContract: {
          balanceOf: vi.fn().mockResolvedValue(0n),
          transfer: vi.fn(),
        },
      });
      await run(argv('--stage=staging', '--execute'), deps);
      expect(deps.usdcContract.transfer).not.toHaveBeenCalled();
      expect(logLines.some((l) => l.includes('transfer-usdc') && l.includes('zero'))).toBe(true);
    });

    it('skips native transfer when balance is zero', async () => {
      const deps = makeDeps({
        provider: {
          getBalance: vi.fn().mockResolvedValue(0n),
          getFeeData: vi.fn(),
        },
        usdcContract: {
          balanceOf: vi.fn().mockResolvedValue(0n),
          transfer: vi.fn(),
        },
      });
      await run(argv('--stage=staging', '--execute'), deps);
      expect(deps.oldSigner.sendTransaction).not.toHaveBeenCalled();
    });

    it('skips native transfer when balance less than gas cost', async () => {
      const deps = makeDeps({
        provider: {
          getBalance: vi.fn().mockResolvedValue(100n),
          getFeeData: vi.fn().mockResolvedValue({ gasPrice: 1000n }),
        },
        usdcContract: {
          balanceOf: vi.fn().mockResolvedValue(0n),
          transfer: vi.fn(),
        },
      });
      await run(argv('--stage=staging', '--execute'), deps);
      expect(logLines.some((l) => l.includes('less than gas'))).toBe(true);
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      mockDdbSend.mockResolvedValue({});
    });

    it('exits 1 when old wallet secret cannot be loaded', async () => {
      mockSmSend.mockRejectedValue(new Error('access denied'));
      await expect(run(argv('--stage=staging', '--execute'), makeDeps())).rejects.toThrow(
        'process.exit(1)',
      );
      expect(exitCode).toBe(1);
    });

    it('continues if balance query fails', async () => {
      mockSmSend.mockImplementation((cmd) => {
        if (cmd._type === 'GetSecret') return { SecretString: OLD_SECRET };
        return {};
      });
      const deps = makeDeps({
        provider: {
          getBalance: vi.fn().mockRejectedValue(new Error('rpc down')),
          getFeeData: vi.fn(),
        },
        usdcContract: {
          balanceOf: vi.fn().mockRejectedValue(new Error('rpc down')),
          transfer: vi.fn(),
        },
      });
      const audit = await run(argv('--stage=staging', '--execute'), deps);
      expect(audit.exitCode).toBe(0);
      expect(logLines.some((l) => l.includes('query-balances') && l.includes('✗'))).toBe(true);
    });

    it('logs error on USDC transfer failure', async () => {
      mockSmSend.mockImplementation((cmd) => {
        if (cmd._type === 'GetSecret') return { SecretString: OLD_SECRET };
        return {};
      });
      const deps = makeDeps({
        usdcContract: {
          balanceOf: vi.fn().mockResolvedValue(1000n),
          transfer: vi.fn().mockRejectedValue(new Error('nonce too low')),
        },
      });
      await run(argv('--stage=staging', '--execute'), deps);
      expect(logLines.some((l) => l.includes('transfer-usdc') && l.includes('✗'))).toBe(true);
      expect(errorLines.some((l) => l.includes('old wallet still holds funds'))).toBe(true);
    });

    it('exits 1 if archive fails — does not update wallet secret', async () => {
      mockSmSend.mockImplementation((cmd) => {
        if (cmd._type === 'GetSecret') return { SecretString: OLD_SECRET };
        if (cmd._type === 'CreateSecret') throw new Error('quota exceeded');
        return {};
      });
      await expect(run(argv('--stage=staging', '--execute'), makeDeps())).rejects.toThrow(
        'process.exit(1)',
      );
      const updates = mockSmSend.mock.calls.filter((c) => c[0]._type === 'UpdateSecret');
      expect(updates).toHaveLength(0);
    });

    it('exits 1 if wallet secret update fails after archive', async () => {
      mockSmSend.mockImplementation((cmd) => {
        if (cmd._type === 'GetSecret') return { SecretString: OLD_SECRET };
        if (cmd._type === 'UpdateSecret') throw new Error('update failed');
        return {};
      });
      await expect(run(argv('--stage=staging', '--execute'), makeDeps())).rejects.toThrow(
        'process.exit(1)',
      );
      expect(errorLines.some((l) => l.includes('secret update failed'))).toBe(true);
    });

    it('handles nonce already initialized gracefully', async () => {
      mockSmSend.mockImplementation((cmd) => {
        if (cmd._type === 'GetSecret') return { SecretString: OLD_SECRET };
        return {};
      });
      const condErr = new Error('already exists');
      condErr.name = 'ConditionalCheckFailedException';
      mockDdbSend.mockRejectedValue(condErr);
      const audit = await run(argv('--stage=staging', '--execute'), makeDeps());
      expect(audit.exitCode).toBe(0);
      expect(logLines.some((l) => l.includes('init-nonce') && l.includes('already exists'))).toBe(
        true,
      );
    });

    it('logs error on unexpected DDB failure', async () => {
      mockSmSend.mockImplementation((cmd) => {
        if (cmd._type === 'GetSecret') return { SecretString: OLD_SECRET };
        return {};
      });
      mockDdbSend.mockRejectedValue(new Error('throttled'));
      const audit = await run(argv('--stage=staging', '--execute'), makeDeps());
      expect(audit.exitCode).toBe(0);
      expect(logLines.some((l) => l.includes('init-nonce') && l.includes('✗'))).toBe(true);
    });

    it('handles native transfer error gracefully', async () => {
      mockSmSend.mockImplementation((cmd) => {
        if (cmd._type === 'GetSecret') return { SecretString: OLD_SECRET };
        return {};
      });
      const deps = makeDeps({
        oldSigner: {
          sendTransaction: vi.fn().mockRejectedValue(new Error('out of gas')),
        },
      });
      const audit = await run(argv('--stage=staging', '--execute'), deps);
      expect(audit.exitCode).toBe(0);
      expect(logLines.some((l) => l.includes('transfer-native') && l.includes('✗'))).toBe(true);
    });
  });

  describe('prod stage', () => {
    beforeEach(() => {
      mockSmSend.mockImplementation((cmd) => {
        if (cmd._type === 'GetSecret') return { SecretString: OLD_SECRET };
        return {};
      });
      mockDdbSend.mockResolvedValue({});
    });

    it('uses x402/prod/ prefix for secret operations', async () => {
      await run(argv('--stage=prod', '--execute'), makeDeps());
      const getCalls = mockSmSend.mock.calls.filter((c) => c[0]._type === 'GetSecret');
      expect(getCalls[0][0].SecretId).toBe('x402/prod/agent-wallet');
    });

    it('archives to x402/prod/agent-wallet-archive-*', async () => {
      await run(argv('--stage=prod', '--execute'), makeDeps());
      const creates = mockSmSend.mock.calls.filter((c) => c[0]._type === 'CreateSecret');
      expect(creates[0][0].Name).toMatch(/^x402\/prod\/agent-wallet-archive-/);
    });
  });

  describe('audit log structure', () => {
    beforeEach(() => {
      mockSmSend.mockImplementation((cmd) => {
        if (cmd._type === 'GetSecret') return { SecretString: OLD_SECRET };
        return {};
      });
      mockDdbSend.mockResolvedValue({});
    });

    it('includes timestamp, stage, and mode', async () => {
      const audit = await run(argv('--stage=staging', '--execute'), makeDeps());
      expect(audit.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(audit.stage).toBe('staging');
      expect(audit.mode).toBe('execute');
    });

    it('records all 7+ steps', async () => {
      const audit = await run(argv('--stage=staging', '--execute'), makeDeps());
      expect(audit.steps.length).toBeGreaterThanOrEqual(7);
      const stepNames = audit.steps.map((s) => s.step);
      expect(stepNames).toContain('load-old-wallet');
      expect(stepNames).toContain('generate-new-wallet');
      expect(stepNames).toContain('query-balances');
      expect(stepNames).toContain('archive-old-key');
      expect(stepNames).toContain('update-wallet-secret');
      expect(stepNames).toContain('init-nonce');
    });

    it('includes txHash on successful transfers', async () => {
      const audit = await run(argv('--stage=staging', '--execute'), makeDeps());
      const usdcStep = audit.steps.find((s) => s.step === 'transfer-usdc');
      expect(usdcStep.txHash).toBe('0xUSDC_TX');
    });
  });
});

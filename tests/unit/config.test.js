import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));

describe('lib/config', () => {
  const BASE_ENV = {
    AWS_REGION: 'us-east-1',
    STAGE: 'dev',
    CHAIN_ID: '8453',
    USDC_CONTRACT_ADDRESS: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    AGENT_WALLET_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:123:secret:wallet',
  };

  const OPTIONAL_ENVS = [
    'CHAIN_RPC_URL',
    'MOONPAY_API_KEY_SECRET_ARN',
    'COINBASE_API_KEY_SECRET_ARN',
    'KRAKEN_API_KEY_SECRET_ARN',
    'BINANCE_API_KEY_SECRET_ARN',
    'UPHOLD_API_KEY_SECRET_ARN',
    'STRIPE_WEBHOOK_SECRET_ARN',
    'BASE_RPC_SECRET_ARN',
    'ADMIN_API_KEY_HASH_SECRET_ARN',
  ];

  beforeEach(() => {
    vi.resetModules();
    for (const [k, v] of Object.entries(BASE_ENV)) {
      process.env[k] = v;
    }
  });

  afterEach(() => {
    for (const k of Object.keys(BASE_ENV)) delete process.env[k];
    for (const k of OPTIONAL_ENVS) delete process.env[k];
  });

  async function freshConfig() {
    const { getConfig } = await import('../../src/lib/config.js');
    return getConfig();
  }

  it('parses minimal config without optional secrets or rpcUrl', async () => {
    const cfg = await freshConfig();
    expect(cfg.awsRegion).toBe('us-east-1');
    expect(cfg.chain.rpcUrl).toBeUndefined();
    expect(cfg.secretArns.stripe).toBeUndefined();
    expect(cfg.secretArns.baseRpc).toBeUndefined();
  });

  it('parses chain.rpcUrl when CHAIN_RPC_URL is set', async () => {
    process.env.CHAIN_RPC_URL = 'https://mainnet.base.org';
    const cfg = await freshConfig();
    expect(cfg.chain.rpcUrl).toBe('https://mainnet.base.org');
  });

  it('parses stripe webhook secret ARN when set', async () => {
    process.env.STRIPE_WEBHOOK_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:stripe';
    const cfg = await freshConfig();
    expect(cfg.secretArns.stripe).toBe('arn:aws:secretsmanager:us-east-1:123:secret:stripe');
  });

  it('parses xrpl config with both USDC and RLUSD issuers when set', async () => {
    process.env.XRPL_PAY_TO = 'rU6K7V3Po4snVhBBaU29sesqs2qTQJWDw1';
    process.env.XRPL_USDC_ISSUER = 'rcEGREd8NmkKRE8GE424sksyt1tJVFZwu';
    process.env.XRPL_RLUSD_ISSUER = 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De';
    const cfg = await freshConfig();
    expect(cfg.xrpl).toEqual({
      payTo: 'rU6K7V3Po4snVhBBaU29sesqs2qTQJWDw1',
      usdcIssuer: 'rcEGREd8NmkKRE8GE424sksyt1tJVFZwu',
      rlusdIssuer: 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De',
    });
    delete process.env.XRPL_PAY_TO;
    delete process.env.XRPL_USDC_ISSUER;
    delete process.env.XRPL_RLUSD_ISSUER;
  });

  it('rejects invalid XRPL_RLUSD_ISSUER address', async () => {
    process.env.XRPL_PAY_TO = 'rU6K7V3Po4snVhBBaU29sesqs2qTQJWDw1';
    process.env.XRPL_RLUSD_ISSUER = 'not-an-xrpl-address';
    await expect(freshConfig()).rejects.toThrow();
    delete process.env.XRPL_PAY_TO;
    delete process.env.XRPL_RLUSD_ISSUER;
  });

  it('leaves rlusdIssuer undefined when only USDC issuer set', async () => {
    process.env.XRPL_PAY_TO = 'rU6K7V3Po4snVhBBaU29sesqs2qTQJWDw1';
    process.env.XRPL_USDC_ISSUER = 'rcEGREd8NmkKRE8GE424sksyt1tJVFZwu';
    const cfg = await freshConfig();
    expect(cfg.xrpl.rlusdIssuer).toBeUndefined();
    expect(cfg.xrpl.usdcIssuer).toBe('rcEGREd8NmkKRE8GE424sksyt1tJVFZwu');
    delete process.env.XRPL_PAY_TO;
    delete process.env.XRPL_USDC_ISSUER;
  });

  it('parses base RPC secret ARN when set', async () => {
    process.env.BASE_RPC_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:base-rpc';
    const cfg = await freshConfig();
    expect(cfg.secretArns.baseRpc).toBe('arn:aws:secretsmanager:us-east-1:123:secret:base-rpc');
  });

  it('throws on missing required fields', async () => {
    delete process.env.AWS_REGION;
    await expect(freshConfig()).rejects.toThrow();
  });

  it('throws on invalid stage', async () => {
    process.env.STAGE = 'invalid';
    await expect(freshConfig()).rejects.toThrow();
  });

  it('throws on invalid USDC contract address', async () => {
    process.env.USDC_CONTRACT_ADDRESS = 'not-an-address';
    await expect(freshConfig()).rejects.toThrow();
  });

  it('uses default payment window when not specified', async () => {
    const cfg = await freshConfig();
    expect(cfg.x402.paymentWindowSeconds).toBe(120);
  });

  it('caches config across calls', async () => {
    const { getConfig } = await import('../../src/lib/config.js');
    const cfg1 = getConfig();
    const cfg2 = getConfig();
    expect(cfg1).toBe(cfg2);
  });

  describe('selfTest', () => {
    beforeEach(async () => {
      const { logger } = await import('../../src/lib/logger.js');
      logger.info.mockClear();
      logger.warn.mockClear();
    });

    async function freshSelfTest() {
      const mod = await import('../../src/lib/config.js');
      return { missing: mod.selfTest(), mod };
    }

    it('returns all 9 optional vars when none are set', async () => {
      const { missing } = await freshSelfTest();
      expect(missing).toHaveLength(9);
      expect(missing.map((m) => m.env)).toContain('CHAIN_RPC_URL');
      expect(missing.map((m) => m.env)).toContain('ADMIN_API_KEY_HASH_SECRET_ARN');
    });

    it('logs a warn for each missing optional var', async () => {
      const { logger } = await import('../../src/lib/logger.js');
      await freshSelfTest();
      expect(logger.warn).toHaveBeenCalledTimes(9);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ env: 'CHAIN_RPC_URL' }),
        expect.stringContaining('CHAIN_RPC_URL not set'),
      );
    });

    it('does not log info when vars are missing', async () => {
      const { logger } = await import('../../src/lib/logger.js');
      await freshSelfTest();
      expect(logger.info).not.toHaveBeenCalled();
    });

    it('returns empty array and logs info when all optional vars are set', async () => {
      process.env.CHAIN_RPC_URL = 'https://mainnet.base.org';
      process.env.MOONPAY_API_KEY_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:mp';
      process.env.COINBASE_API_KEY_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:cb';
      process.env.KRAKEN_API_KEY_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:kr';
      process.env.BINANCE_API_KEY_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:bn';
      process.env.UPHOLD_API_KEY_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:up';
      process.env.STRIPE_WEBHOOK_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:st';
      process.env.BASE_RPC_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:rpc';
      process.env.ADMIN_API_KEY_HASH_SECRET_ARN =
        'arn:aws:secretsmanager:us-east-1:123:secret:admin';

      const { logger } = await import('../../src/lib/logger.js');
      const { missing } = await freshSelfTest();

      expect(missing).toHaveLength(0);
      expect(logger.info).toHaveBeenCalledWith('config self-test: all optional env vars present');
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('returns only the missing vars when some are set', async () => {
      process.env.CHAIN_RPC_URL = 'https://mainnet.base.org';
      process.env.STRIPE_WEBHOOK_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:st';

      const { missing } = await freshSelfTest();
      expect(missing).toHaveLength(7);
      const envs = missing.map((m) => m.env);
      expect(envs).not.toContain('CHAIN_RPC_URL');
      expect(envs).not.toContain('STRIPE_WEBHOOK_SECRET_ARN');
      expect(envs).toContain('MOONPAY_API_KEY_SECRET_ARN');
    });

    it('each missing entry has env and impact fields', async () => {
      const { missing } = await freshSelfTest();
      for (const m of missing) {
        expect(m).toHaveProperty('env');
        expect(m).toHaveProperty('impact');
        expect(typeof m.env).toBe('string');
        expect(typeof m.impact).toBe('string');
      }
    });

    it('warn messages include the impact description', async () => {
      const { logger } = await import('../../src/lib/logger.js');
      await freshSelfTest();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ impact: 'on-chain payment verification disabled' }),
        expect.stringContaining('on-chain payment verification disabled'),
      );
    });

    it('can be called multiple times safely (uses cached config)', async () => {
      const mod = await import('../../src/lib/config.js');
      const r1 = mod.selfTest();
      const r2 = mod.selfTest();
      expect(r1).toEqual(r2);
    });
  });
});

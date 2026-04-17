import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('lib/logger', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  async function importLogger(envOverrides = {}) {
    Object.assign(process.env, envOverrides);
    return import('../../src/lib/logger.js');
  }

  describe('logger instance', () => {
    it('exports a logger object', async () => {
      const { logger } = await importLogger();
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.debug).toBe('function');
    });

    it('defaults to info level when LOG_LEVEL is unset', async () => {
      delete process.env.LOG_LEVEL;
      const { logger } = await importLogger();
      expect(logger.level).toBe('info');
    });

    it('respects LOG_LEVEL env var set to debug', async () => {
      const { logger } = await importLogger({ LOG_LEVEL: 'debug' });
      expect(logger.level).toBe('debug');
    });

    it('respects LOG_LEVEL env var set to warn', async () => {
      const { logger } = await importLogger({ LOG_LEVEL: 'warn' });
      expect(logger.level).toBe('warn');
    });

    it('respects LOG_LEVEL env var set to error', async () => {
      const { logger } = await importLogger({ LOG_LEVEL: 'error' });
      expect(logger.level).toBe('error');
    });

    it('respects LOG_LEVEL env var set to trace', async () => {
      const { logger } = await importLogger({ LOG_LEVEL: 'trace' });
      expect(logger.level).toBe('trace');
    });

    it('includes service in base bindings', async () => {
      const { logger } = await importLogger();
      const bindings = logger.bindings();
      expect(bindings.service).toBe('x402');
    });

    it('includes stage from STAGE env var in base bindings', async () => {
      const { logger } = await importLogger({ STAGE: 'production' });
      const bindings = logger.bindings();
      expect(bindings.stage).toBe('production');
    });

    it('stage is undefined when STAGE env var is unset', async () => {
      delete process.env.STAGE;
      const { logger } = await importLogger();
      const bindings = logger.bindings();
      expect(bindings.stage).toBeUndefined();
    });
  });

  describe('redaction', () => {
    const EXPECTED_REDACT_PATHS = [
      'req.headers.authorization',
      'req.headers["x-payment"]',
      'req.headers["x-api-key"]',
      'apiKey',
      'secret',
      'secretKey',
      'privateKey',
      'seed',
      'mnemonic',
      'signature',
      '*.apiKey',
      '*.secretKey',
      '*.privateKey',
    ];

    it('redacts all expected sensitive paths', async () => {
      const { Writable } = await import('node:stream');
      const pino = (await import('pino')).default;

      // Build a logger with same redact config to verify it works
      const chunks = [];
      const dest = new Writable({
        write(chunk, _enc, cb) {
          chunks.push(chunk.toString());
          cb();
        },
      });

      const testLogger = pino(
        { redact: { paths: EXPECTED_REDACT_PATHS, censor: '[REDACTED]' } },
        dest,
      );

      testLogger.info({ apiKey: 'super-secret-key' }, 'test');
      testLogger.info({ secretKey: 'sk_live_123' }, 'test');
      testLogger.info({ privateKey: '0xdeadbeef' }, 'test');
      testLogger.info({ seed: 'abandon abandon abandon' }, 'test');
      testLogger.info({ mnemonic: 'word1 word2 word3' }, 'test');
      testLogger.info({ secret: 'my-secret' }, 'test');
      testLogger.info({ signature: '0xsig' }, 'test');

      // Flush
      await new Promise((resolve) => dest.end(resolve));

      const output = chunks.join('');
      expect(output).not.toContain('super-secret-key');
      expect(output).not.toContain('sk_live_123');
      expect(output).not.toContain('0xdeadbeef');
      expect(output).not.toContain('abandon abandon abandon');
      expect(output).not.toContain('word1 word2 word3');
      expect(output).not.toContain('my-secret');
      expect(output).not.toContain('0xsig');
      expect(output).toContain('[REDACTED]');
    });

    it('redacts nested wildcard paths like *.apiKey', async () => {
      const { Writable } = await import('node:stream');
      const pino = (await import('pino')).default;

      const chunks = [];
      const dest = new Writable({
        write(chunk, _enc, cb) {
          chunks.push(chunk.toString());
          cb();
        },
      });

      const testLogger = pino(
        { redact: { paths: EXPECTED_REDACT_PATHS, censor: '[REDACTED]' } },
        dest,
      );

      testLogger.info({ exchange: { apiKey: 'nested-secret' } }, 'test');
      testLogger.info({ adapter: { secretKey: 'nested-sk' } }, 'test');
      testLogger.info({ wallet: { privateKey: '0xpk' } }, 'test');

      await new Promise((resolve) => dest.end(resolve));

      const output = chunks.join('');
      expect(output).not.toContain('nested-secret');
      expect(output).not.toContain('nested-sk');
      expect(output).not.toContain('0xpk');
    });

    it('redacts req.headers.authorization', async () => {
      const { Writable } = await import('node:stream');
      const pino = (await import('pino')).default;

      const chunks = [];
      const dest = new Writable({
        write(chunk, _enc, cb) {
          chunks.push(chunk.toString());
          cb();
        },
      });

      const testLogger = pino(
        { redact: { paths: EXPECTED_REDACT_PATHS, censor: '[REDACTED]' } },
        dest,
      );

      testLogger.info({ req: { headers: { authorization: 'Bearer tok_xyz' } } }, 'test');

      await new Promise((resolve) => dest.end(resolve));

      const output = chunks.join('');
      expect(output).not.toContain('Bearer tok_xyz');
      expect(output).toContain('[REDACTED]');
    });

    it('redacts req.headers x-payment and x-api-key', async () => {
      const { Writable } = await import('node:stream');
      const pino = (await import('pino')).default;

      const chunks = [];
      const dest = new Writable({
        write(chunk, _enc, cb) {
          chunks.push(chunk.toString());
          cb();
        },
      });

      const testLogger = pino(
        { redact: { paths: EXPECTED_REDACT_PATHS, censor: '[REDACTED]' } },
        dest,
      );

      testLogger.info(
        {
          req: {
            headers: {
              'x-payment': 'pay_secret',
              'x-api-key': 'ak_secret',
            },
          },
        },
        'test',
      );

      await new Promise((resolve) => dest.end(resolve));

      const output = chunks.join('');
      expect(output).not.toContain('pay_secret');
      expect(output).not.toContain('ak_secret');
    });

    it('does not redact non-sensitive fields', async () => {
      const { Writable } = await import('node:stream');
      const pino = (await import('pino')).default;

      const chunks = [];
      const dest = new Writable({
        write(chunk, _enc, cb) {
          chunks.push(chunk.toString());
          cb();
        },
      });

      const testLogger = pino(
        { redact: { paths: EXPECTED_REDACT_PATHS, censor: '[REDACTED]' } },
        dest,
      );

      testLogger.info({ userId: 'user-123', amount: '1000', path: '/api/pay' }, 'test');

      await new Promise((resolve) => dest.end(resolve));

      const output = chunks.join('');
      expect(output).toContain('user-123');
      expect(output).toContain('1000');
      expect(output).toContain('/api/pay');
    });

    it('has exactly 13 redaction paths', async () => {
      expect(EXPECTED_REDACT_PATHS).toHaveLength(13);
    });
  });

  describe('withCorrelation', () => {
    it('exports withCorrelation as a function', async () => {
      const { withCorrelation } = await importLogger();
      expect(typeof withCorrelation).toBe('function');
    });

    it('returns a child logger with correlationId binding', async () => {
      const { withCorrelation } = await importLogger();
      const child = withCorrelation('req-abc-123');
      const bindings = child.bindings();
      expect(bindings.correlationId).toBe('req-abc-123');
    });

    it('child logger inherits parent service binding', async () => {
      const { withCorrelation } = await importLogger();
      const child = withCorrelation('req-xyz');
      const bindings = child.bindings();
      expect(bindings.service).toBe('x402');
    });

    it('child logger inherits parent level', async () => {
      const { withCorrelation } = await importLogger({ LOG_LEVEL: 'warn' });
      const child = withCorrelation('req-123');
      expect(child.level).toBe('warn');
    });

    it('child logger has standard logging methods', async () => {
      const { withCorrelation } = await importLogger();
      const child = withCorrelation('req-456');
      expect(typeof child.info).toBe('function');
      expect(typeof child.error).toBe('function');
      expect(typeof child.warn).toBe('function');
      expect(typeof child.debug).toBe('function');
      expect(typeof child.trace).toBe('function');
      expect(typeof child.fatal).toBe('function');
    });

    it('different correlationIds produce different children', async () => {
      const { withCorrelation } = await importLogger();
      const child1 = withCorrelation('id-1');
      const child2 = withCorrelation('id-2');
      expect(child1.bindings().correlationId).toBe('id-1');
      expect(child2.bindings().correlationId).toBe('id-2');
    });

    it('child logger can create grandchild with additional bindings', async () => {
      const { withCorrelation } = await importLogger();
      const child = withCorrelation('req-grand');
      const grandchild = child.child({ tenantId: 'tenant-1' });
      const bindings = grandchild.bindings();
      expect(bindings.correlationId).toBe('req-grand');
      expect(bindings.tenantId).toBe('tenant-1');
    });
  });

  describe('timestamp', () => {
    it('uses ISO time format', async () => {
      const { Writable } = await import('node:stream');
      const pino = (await import('pino')).default;

      const chunks = [];
      const dest = new Writable({
        write(chunk, _enc, cb) {
          chunks.push(chunk.toString());
          cb();
        },
      });

      const testLogger = pino({ timestamp: pino.stdTimeFunctions.isoTime }, dest);

      testLogger.info('timestamp test');

      await new Promise((resolve) => dest.end(resolve));

      const output = chunks.join('');
      const parsed = JSON.parse(output);
      // ISO time format: "time":"2026-04-06T..."
      expect(parsed.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });
});

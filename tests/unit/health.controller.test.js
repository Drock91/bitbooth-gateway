import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockCheckReady = vi.fn();
const mockEnforceHealthRateLimit = vi.fn();
const mockExtractClientIp = vi.fn();

vi.mock('../../src/services/health.service.js', () => ({
  checkReady: (...args) => mockCheckReady(...args),
}));

vi.mock('../../src/middleware/error.middleware.js', () => ({
  jsonResponse: (status, body) => ({
    statusCode: status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(body),
  }),
}));

vi.mock('../../src/middleware/rate-limit.middleware.js', () => ({
  enforceHealthRateLimit: (...args) => mockEnforceHealthRateLimit(...args),
  extractClientIp: (...args) => mockExtractClientIp(...args),
  rateLimitHeaders: (info) => ({
    'ratelimit-limit': String(info.limit),
    'ratelimit-remaining': String(info.remaining),
    'ratelimit-reset': String(info.reset),
  }),
}));

describe('health.controller', () => {
  let getHealth;
  let getHealthReady;

  const rlInfo = { limit: 60, remaining: 59, reset: 60 };

  beforeEach(async () => {
    vi.resetModules();
    mockCheckReady.mockReset();
    mockEnforceHealthRateLimit.mockReset();
    mockExtractClientIp.mockReset();

    mockExtractClientIp.mockReturnValue('1.2.3.4');
    mockEnforceHealthRateLimit.mockResolvedValue(rlInfo);

    const mod = await import('../../src/controllers/health.controller.js');
    getHealth = mod.getHealth;
    getHealthReady = mod.getHealthReady;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getHealth', () => {
    it('returns 200 with ok:true and stage', async () => {
      const origStage = process.env.STAGE;
      process.env.STAGE = 'test-stage';

      const res = await getHealth({ requestContext: { identity: { sourceIp: '1.2.3.4' } } });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
      expect(body.stage).toBe('test-stage');

      if (origStage === undefined) delete process.env.STAGE;
      else process.env.STAGE = origStage;
    });

    it('extracts client IP from event', async () => {
      const event = { requestContext: { identity: { sourceIp: '10.0.0.1' } } };
      await getHealth(event);

      expect(mockExtractClientIp).toHaveBeenCalledWith(event);
    });

    it('enforces health rate limit with extracted IP', async () => {
      mockExtractClientIp.mockReturnValue('10.0.0.1');
      await getHealth({});

      expect(mockEnforceHealthRateLimit).toHaveBeenCalledWith('10.0.0.1');
    });

    it('includes rate limit headers in response', async () => {
      const res = await getHealth({});

      expect(res.headers['ratelimit-limit']).toBe('60');
      expect(res.headers['ratelimit-remaining']).toBe('59');
      expect(res.headers['ratelimit-reset']).toBe('60');
    });

    it('propagates rate limit errors', async () => {
      const err = new Error('Too many requests');
      err.status = 429;
      mockEnforceHealthRateLimit.mockRejectedValue(err);

      await expect(getHealth({})).rejects.toThrow('Too many requests');
    });

    it('returns stage as undefined when STAGE env is not set', async () => {
      const origStage = process.env.STAGE;
      delete process.env.STAGE;

      const res = await getHealth({});
      const body = JSON.parse(res.body);
      expect(body.stage).toBeUndefined();

      if (origStage !== undefined) process.env.STAGE = origStage;
    });
  });

  describe('getHealthReady', () => {
    it('returns 200 when all checks pass', async () => {
      mockCheckReady.mockResolvedValue({
        ok: true,
        stage: 'dev',
        checks: [
          { name: 'dynamodb', ok: true, latencyMs: 5 },
          { name: 'secrets', ok: true, latencyMs: 3 },
          { name: 'chain_rpc', ok: true, latencyMs: 10 },
        ],
      });

      const res = await getHealthReady({ requestContext: { identity: { sourceIp: '1.2.3.4' } } });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
      expect(body.stage).toBe('dev');
      expect(body.checks).toHaveLength(3);
    });

    it('returns 503 when any check fails', async () => {
      mockCheckReady.mockResolvedValue({
        ok: false,
        stage: 'dev',
        checks: [
          { name: 'dynamodb', ok: true, latencyMs: 5 },
          { name: 'secrets', ok: false, latencyMs: 3, error: 'Access denied' },
          { name: 'chain_rpc', ok: true, latencyMs: 10 },
        ],
      });

      const res = await getHealthReady({});

      expect(res.statusCode).toBe(503);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(false);
      expect(body.checks.find((c) => c.name === 'secrets').error).toBe('Access denied');
    });

    it('returns 503 when all checks fail', async () => {
      mockCheckReady.mockResolvedValue({
        ok: false,
        stage: 'staging',
        checks: [
          { name: 'dynamodb', ok: false, latencyMs: 1, error: 'timeout' },
          { name: 'secrets', ok: false, latencyMs: 2, error: 'access denied' },
          { name: 'chain_rpc', ok: false, latencyMs: 3, error: 'ECONNREFUSED' },
        ],
      });

      const res = await getHealthReady({});

      expect(res.statusCode).toBe(503);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(false);
      expect(body.checks.every((c) => !c.ok)).toBe(true);
    });

    it('includes rate limit headers in response', async () => {
      mockCheckReady.mockResolvedValue({ ok: true, stage: 'dev', checks: [] });

      const res = await getHealthReady({});

      expect(res.headers['ratelimit-limit']).toBe('60');
      expect(res.headers['ratelimit-remaining']).toBe('59');
      expect(res.headers['ratelimit-reset']).toBe('60');
    });

    it('extracts client IP and enforces rate limit', async () => {
      mockExtractClientIp.mockReturnValue('192.168.1.1');
      mockCheckReady.mockResolvedValue({ ok: true, stage: 'dev', checks: [] });

      await getHealthReady({});

      expect(mockEnforceHealthRateLimit).toHaveBeenCalledWith('192.168.1.1');
    });

    it('propagates rate limit errors before calling service', async () => {
      const err = new Error('Too many requests');
      err.status = 429;
      mockEnforceHealthRateLimit.mockRejectedValue(err);

      await expect(getHealthReady({})).rejects.toThrow('Too many requests');
      expect(mockCheckReady).not.toHaveBeenCalled();
    });

    it('propagates unhandled service errors', async () => {
      mockCheckReady.mockRejectedValue(new Error('Config parse failed'));

      await expect(getHealthReady({})).rejects.toThrow('Config parse failed');
    });

    it('passes through stage from service', async () => {
      mockCheckReady.mockResolvedValue({
        ok: true,
        stage: 'prod',
        checks: [{ name: 'dynamodb', ok: true, latencyMs: 1 }],
      });

      const res = await getHealthReady({});
      const body = JSON.parse(res.body);
      expect(body.stage).toBe('prod');
    });
  });
});

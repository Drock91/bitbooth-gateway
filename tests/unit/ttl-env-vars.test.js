import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {},
}));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
  GetCommand: vi.fn(function (p) {
    Object.assign(this, { _type: 'Get', ...p });
  }),
  PutCommand: vi.fn(function (p) {
    Object.assign(this, { _type: 'Put', ...p });
  }),
  QueryCommand: vi.fn(function (p) {
    Object.assign(this, { _type: 'Query', ...p });
  }),
  UpdateCommand: vi.fn(function (p) {
    Object.assign(this, { _type: 'Update', ...p });
  }),
}));
vi.mock('../../src/lib/config.js', () => ({
  getConfig: () => ({ awsRegion: 'us-east-1' }),
}));

const savedEnv = {};

beforeEach(() => {
  mockSend.mockReset();
});

afterEach(() => {
  for (const key of Object.keys(savedEnv)) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function saveEnv(key) {
  savedEnv[key] = process.env[key];
}

describe('TTL env-var overrides', () => {
  describe('IDEMPOTENCY_TTL_SECONDS', () => {
    it('uses default 86400 when env var is unset', async () => {
      saveEnv('IDEMPOTENCY_TTL_SECONDS');
      delete process.env.IDEMPOTENCY_TTL_SECONDS;
      vi.resetModules();
      const { idempotencyRepo } = await import('../../src/repositories/idempotency.repo.js');

      mockSend.mockResolvedValueOnce({});
      await idempotencyRepo.lockKey('k1');
      const cmd = mockSend.mock.calls[0][0];
      const expected = Math.floor(Date.now() / 1000) + 86400;
      expect(cmd.Item.ttl).toBeGreaterThanOrEqual(expected - 5);
      expect(cmd.Item.ttl).toBeLessThanOrEqual(expected + 5);
    });

    it('respects custom TTL from env var', async () => {
      saveEnv('IDEMPOTENCY_TTL_SECONDS');
      process.env.IDEMPOTENCY_TTL_SECONDS = '3600';
      vi.resetModules();
      const { idempotencyRepo } = await import('../../src/repositories/idempotency.repo.js');

      mockSend.mockResolvedValueOnce({});
      await idempotencyRepo.lockKey('k1');
      const cmd = mockSend.mock.calls[0][0];
      const expected = Math.floor(Date.now() / 1000) + 3600;
      expect(cmd.Item.ttl).toBeGreaterThanOrEqual(expected - 5);
      expect(cmd.Item.ttl).toBeLessThanOrEqual(expected + 5);
    });

    it('applies custom TTL in complete method', async () => {
      saveEnv('IDEMPOTENCY_TTL_SECONDS');
      process.env.IDEMPOTENCY_TTL_SECONDS = '7200';
      vi.resetModules();
      const { idempotencyRepo } = await import('../../src/repositories/idempotency.repo.js');

      mockSend.mockResolvedValueOnce({});
      await idempotencyRepo.complete('k1', 200, '{}', {});
      const cmd = mockSend.mock.calls[0][0];
      const expected = Math.floor(Date.now() / 1000) + 7200;
      expect(cmd.ExpressionAttributeValues[':t']).toBeGreaterThanOrEqual(expected - 5);
      expect(cmd.ExpressionAttributeValues[':t']).toBeLessThanOrEqual(expected + 5);
    });
  });

  describe('FRAUD_EVENT_TTL_DAYS', () => {
    it('uses default 30 days when env var is unset', async () => {
      saveEnv('FRAUD_EVENT_TTL_DAYS');
      delete process.env.FRAUD_EVENT_TTL_DAYS;
      vi.resetModules();
      const { fraudRepo } = await import('../../src/repositories/fraud.repo.js');

      mockSend.mockResolvedValueOnce({});
      const ev = await fraudRepo.recordEvent({
        accountId: 'acct-1',
        eventType: 'high_velocity',
        severity: 'high',
        details: {},
      });
      const expected = Math.floor(Date.now() / 1000) + 30 * 86400;
      expect(ev.ttl).toBeGreaterThanOrEqual(expected - 5);
      expect(ev.ttl).toBeLessThanOrEqual(expected + 5);
    });

    it('respects custom TTL from env var', async () => {
      saveEnv('FRAUD_EVENT_TTL_DAYS');
      process.env.FRAUD_EVENT_TTL_DAYS = '7';
      vi.resetModules();
      const { fraudRepo } = await import('../../src/repositories/fraud.repo.js');

      mockSend.mockResolvedValueOnce({});
      const ev = await fraudRepo.recordEvent({
        accountId: 'acct-1',
        eventType: 'high_velocity',
        severity: 'high',
        details: {},
      });
      const expected = Math.floor(Date.now() / 1000) + 7 * 86400;
      expect(ev.ttl).toBeGreaterThanOrEqual(expected - 5);
      expect(ev.ttl).toBeLessThanOrEqual(expected + 5);
    });
  });

  describe('WEBHOOK_DLQ_TTL_DAYS', () => {
    it('uses default 30 days when env var is unset', async () => {
      saveEnv('WEBHOOK_DLQ_TTL_DAYS');
      delete process.env.WEBHOOK_DLQ_TTL_DAYS;
      vi.resetModules();
      const { webhookDlqRepo } = await import('../../src/repositories/webhook-dlq.repo.js');

      mockSend.mockResolvedValueOnce({});
      const item = await webhookDlqRepo.record({
        eventId: '550e8400-e29b-41d4-a716-446655440000',
        provider: 'moonpay',
        payload: '{}',
        headers: {},
        errorMessage: 'fail',
        errorCode: 'ERR',
      });
      const expected = Math.floor(Date.now() / 1000) + 30 * 86400;
      expect(item.ttl).toBeGreaterThanOrEqual(expected - 5);
      expect(item.ttl).toBeLessThanOrEqual(expected + 5);
    });

    it('respects custom TTL from env var', async () => {
      saveEnv('WEBHOOK_DLQ_TTL_DAYS');
      process.env.WEBHOOK_DLQ_TTL_DAYS = '14';
      vi.resetModules();
      const { webhookDlqRepo } = await import('../../src/repositories/webhook-dlq.repo.js');

      mockSend.mockResolvedValueOnce({});
      const item = await webhookDlqRepo.record({
        eventId: '550e8400-e29b-41d4-a716-446655440000',
        provider: 'moonpay',
        payload: '{}',
        headers: {},
        errorMessage: 'fail',
        errorCode: 'ERR',
      });
      const expected = Math.floor(Date.now() / 1000) + 14 * 86400;
      expect(item.ttl).toBeGreaterThanOrEqual(expected - 5);
      expect(item.ttl).toBeLessThanOrEqual(expected + 5);
    });
  });

  describe('SECRET_CACHE_TTL_MS', () => {
    it('uses default 5m TTL when env var is unset', async () => {
      saveEnv('SECRET_CACHE_TTL_MS');
      delete process.env.SECRET_CACHE_TTL_MS;
      vi.resetModules();

      const sendMock = vi.fn();
      vi.doMock('@aws-sdk/client-secrets-manager', () => ({
        SecretsManagerClient: class {
          constructor() {
            this.send = sendMock;
          }
        },
        GetSecretValueCommand: vi.fn(function (p) {
          Object.assign(this, p);
        }),
      }));
      vi.doMock('../../src/lib/config.js', () => ({
        getConfig: () => ({ awsRegion: 'us-east-1' }),
      }));

      const { getSecret } = await import('../../src/lib/secrets.js');

      sendMock.mockResolvedValue({ SecretString: 'val' });
      await getSecret('arn:test');
      await getSecret('arn:test');
      expect(sendMock).toHaveBeenCalledOnce();
    });

    it('respects shorter TTL from env var', async () => {
      saveEnv('SECRET_CACHE_TTL_MS');
      process.env.SECRET_CACHE_TTL_MS = '1000';
      vi.resetModules();

      const sendMock = vi.fn();
      vi.doMock('@aws-sdk/client-secrets-manager', () => ({
        SecretsManagerClient: class {
          constructor() {
            this.send = sendMock;
          }
        },
        GetSecretValueCommand: vi.fn(function (p) {
          Object.assign(this, p);
        }),
      }));
      vi.doMock('../../src/lib/config.js', () => ({
        getConfig: () => ({ awsRegion: 'us-east-1' }),
      }));

      const { getSecret } = await import('../../src/lib/secrets.js');

      sendMock.mockResolvedValue({ SecretString: 'val' });
      await getSecret('arn:short-ttl');

      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 2000);
      await getSecret('arn:short-ttl');
      expect(sendMock).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });
  });
});

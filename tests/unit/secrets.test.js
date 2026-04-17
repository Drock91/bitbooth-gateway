import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMock = vi.hoisted(() => vi.fn());
vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class {
    constructor() {
      this.send = sendMock;
    }
  },
  GetSecretValueCommand: vi.fn(function (params) {
    Object.assign(this, { input: params });
  }),
}));

vi.mock('../../src/lib/config.js', () => ({
  getConfig: () => ({ awsRegion: 'us-east-1' }),
}));

describe('lib/secrets', () => {
  let getSecret, getSecretJson;

  beforeEach(async () => {
    vi.resetModules();
    sendMock.mockReset();

    vi.doMock('@aws-sdk/client-secrets-manager', () => ({
      SecretsManagerClient: class {
        constructor() {
          this.send = sendMock;
        }
      },
      GetSecretValueCommand: vi.fn(function (params) {
        Object.assign(this, { input: params });
      }),
    }));
    vi.doMock('../../src/lib/config.js', () => ({
      getConfig: () => ({ awsRegion: 'us-east-1' }),
    }));

    const mod = await import('../../src/lib/secrets.js');
    getSecret = mod.getSecret;
    getSecretJson = mod.getSecretJson;
  });

  describe('getSecret', () => {
    it('fetches secret from SecretsManager', async () => {
      sendMock.mockResolvedValueOnce({ SecretString: 'my-secret' });
      const result = await getSecret('arn:aws:secretsmanager:us-east-1:123:secret:test');
      expect(result).toBe('my-secret');
      expect(sendMock).toHaveBeenCalledOnce();
    });

    it('caches the secret on subsequent calls within TTL', async () => {
      sendMock.mockResolvedValueOnce({ SecretString: 'cached-val' });
      const arn = 'arn:aws:secretsmanager:us-east-1:123:secret:cached';

      const first = await getSecret(arn);
      const second = await getSecret(arn);

      expect(first).toBe('cached-val');
      expect(second).toBe('cached-val');
      expect(sendMock).toHaveBeenCalledOnce();
    });

    it('re-fetches after TTL expires', async () => {
      sendMock.mockResolvedValueOnce({ SecretString: 'old' });
      sendMock.mockResolvedValueOnce({ SecretString: 'new' });
      const arn = 'arn:aws:secretsmanager:us-east-1:123:secret:ttl';

      await getSecret(arn);

      // Advance time past TTL (5 minutes)
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 6 * 60 * 1000);

      const result = await getSecret(arn);
      expect(result).toBe('new');
      expect(sendMock).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('throws when SecretString is empty', async () => {
      sendMock.mockResolvedValueOnce({ SecretString: '' });
      const arn = 'arn:aws:secretsmanager:us-east-1:123:secret:empty';
      await expect(getSecret(arn)).rejects.toThrow('has no SecretString');
    });

    it('throws when SecretString is undefined', async () => {
      sendMock.mockResolvedValueOnce({});
      const arn = 'arn:aws:secretsmanager:us-east-1:123:secret:undef';
      await expect(getSecret(arn)).rejects.toThrow('has no SecretString');
    });

    it('propagates AWS SDK errors', async () => {
      sendMock.mockRejectedValueOnce(new Error('AccessDenied'));
      const arn = 'arn:aws:secretsmanager:us-east-1:123:secret:denied';
      await expect(getSecret(arn)).rejects.toThrow('AccessDenied');
    });

    it('caches different ARNs independently', async () => {
      sendMock.mockResolvedValueOnce({ SecretString: 'val-a' });
      sendMock.mockResolvedValueOnce({ SecretString: 'val-b' });

      const a = await getSecret('arn:a');
      const b = await getSecret('arn:b');

      expect(a).toBe('val-a');
      expect(b).toBe('val-b');
      expect(sendMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('getSecretJson', () => {
    it('parses JSON from secret string', async () => {
      sendMock.mockResolvedValueOnce({ SecretString: '{"apiKey":"abc123"}' });
      const arn = 'arn:aws:secretsmanager:us-east-1:123:secret:json';
      const result = await getSecretJson(arn);
      expect(result).toEqual({ apiKey: 'abc123' });
    });

    it('throws on invalid JSON', async () => {
      sendMock.mockResolvedValueOnce({ SecretString: 'not-json{' });
      const arn = 'arn:aws:secretsmanager:us-east-1:123:secret:badjson';
      await expect(getSecretJson(arn)).rejects.toThrow();
    });

    it('uses the same cache as getSecret', async () => {
      sendMock.mockResolvedValueOnce({ SecretString: '{"x":1}' });
      const arn = 'arn:aws:secretsmanager:us-east-1:123:secret:shared';

      await getSecret(arn);
      const json = await getSecretJson(arn);

      expect(json).toEqual({ x: 1 });
      expect(sendMock).toHaveBeenCalledOnce();
    });
  });
});

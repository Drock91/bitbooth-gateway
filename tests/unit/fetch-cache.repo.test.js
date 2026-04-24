import { describe, it, expect, vi, beforeEach } from 'vitest';

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
}));
vi.mock('../../src/lib/config.js', () => ({
  getConfig: () => ({ awsRegion: 'us-east-1' }),
}));

import { fetchCacheRepo, cacheKey } from '../../src/repositories/fetch-cache.repo.js';
import { PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

describe('fetch-cache.repo', () => {
  beforeEach(() => {
    mockSend.mockReset();
    PutCommand.mockClear();
    GetCommand.mockClear();
  });

  describe('cacheKey', () => {
    it('returns a deterministic hash for the same url+mode', () => {
      const a = cacheKey('https://example.com', 'fast');
      const b = cacheKey('https://example.com', 'fast');
      expect(a).toBe(b);
    });

    it('returns different hashes for different modes', () => {
      const fast = cacheKey('https://example.com', 'fast');
      const full = cacheKey('https://example.com', 'full');
      expect(fast).not.toBe(full);
    });

    it('returns different hashes for different urls', () => {
      const a = cacheKey('https://a.com', 'fast');
      const b = cacheKey('https://b.com', 'fast');
      expect(a).not.toBe(b);
    });

    it('returns a 64-char hex string (SHA-256)', () => {
      const key = cacheKey('https://example.com', 'fast');
      expect(key).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('get', () => {
    it('returns null when item not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      const result = await fetchCacheRepo.get('key1');
      expect(result).toBeNull();
    });

    it('returns item when found and not expired', async () => {
      const item = {
        cacheKey: 'key1',
        title: 'Title',
        markdown: '# Hello',
        ttl: Math.floor(Date.now() / 1000) + 300,
      };
      mockSend.mockResolvedValueOnce({ Item: item });
      const result = await fetchCacheRepo.get('key1');
      expect(result).toEqual(item);
    });

    it('returns null when item is expired', async () => {
      const item = {
        cacheKey: 'key1',
        title: 'Old',
        markdown: '# Old',
        ttl: Math.floor(Date.now() / 1000) - 10,
      };
      mockSend.mockResolvedValueOnce({ Item: item });
      const result = await fetchCacheRepo.get('key1');
      expect(result).toBeNull();
    });

    it('sends GetCommand with correct table and key', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      await fetchCacheRepo.get('abc');
      expect(GetCommand).toHaveBeenCalledWith({
        TableName: 'x402-fetch-cache',
        Key: { cacheKey: 'abc' },
      });
    });

    it('returns item when ttl is absent (no expiry)', async () => {
      const item = { cacheKey: 'key1', title: 'T', markdown: '# M' };
      mockSend.mockResolvedValueOnce({ Item: item });
      const result = await fetchCacheRepo.get('key1');
      expect(result).toEqual(item);
    });
  });

  describe('put', () => {
    it('writes item with correct fields', async () => {
      mockSend.mockResolvedValueOnce({});
      const data = {
        url: 'https://example.com',
        mode: 'fast',
        title: 'Example',
        markdown: '# Example',
        metadata: { url: 'https://example.com', fetchedAt: '2026-01-01T00:00:00.000Z' },
      };

      await fetchCacheRepo.put('key1', data);

      expect(PutCommand).toHaveBeenCalledTimes(1);
      const call = PutCommand.mock.calls[0][0];
      expect(call.TableName).toBe('x402-fetch-cache');
      expect(call.Item.cacheKey).toBe('key1');
      expect(call.Item.url).toBe('https://example.com');
      expect(call.Item.mode).toBe('fast');
      expect(call.Item.title).toBe('Example');
      expect(call.Item.markdown).toBe('# Example');
      expect(JSON.parse(call.Item.metadata)).toEqual(data.metadata);
      expect(call.Item.ttl).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('uses default TTL of 300 seconds when not specified', async () => {
      mockSend.mockResolvedValueOnce({});
      const now = Math.floor(Date.now() / 1000);

      await fetchCacheRepo.put('key1', {
        url: 'https://x.com',
        mode: 'fast',
        title: '',
        markdown: '',
        metadata: {},
      });

      const call = PutCommand.mock.calls[0][0];
      expect(call.Item.ttl).toBeGreaterThanOrEqual(now + 299);
      expect(call.Item.ttl).toBeLessThanOrEqual(now + 302);
    });

    it('respects custom TTL', async () => {
      mockSend.mockResolvedValueOnce({});
      const now = Math.floor(Date.now() / 1000);

      await fetchCacheRepo.put(
        'key1',
        { url: 'https://x.com', mode: 'full', title: '', markdown: '', metadata: {} },
        600,
      );

      const call = PutCommand.mock.calls[0][0];
      expect(call.Item.ttl).toBeGreaterThanOrEqual(now + 599);
      expect(call.Item.ttl).toBeLessThanOrEqual(now + 602);
    });

    it('stores ISO createdAt timestamp', async () => {
      mockSend.mockResolvedValueOnce({});

      await fetchCacheRepo.put('key1', {
        url: 'https://x.com',
        mode: 'fast',
        title: '',
        markdown: '',
        metadata: {},
      });

      const call = PutCommand.mock.calls[0][0];
      expect(() => new Date(call.Item.createdAt)).not.toThrow();
      expect(new Date(call.Item.createdAt).toISOString()).toBe(call.Item.createdAt);
    });

    it('propagates DDB errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('DDB down'));

      await expect(
        fetchCacheRepo.put('key1', {
          url: 'https://x.com',
          mode: 'fast',
          title: '',
          markdown: '',
          metadata: {},
        }),
      ).rejects.toThrow('DDB down');
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetByApiKeyHash } = vi.hoisted(() => ({
  mockGetByApiKeyHash: vi.fn(),
}));
vi.mock('../../src/repositories/tenants.repo.js', () => ({
  tenantsRepo: { getByApiKeyHash: mockGetByApiKeyHash },
}));

import { authenticate } from '../../src/middleware/auth.middleware.js';

const ACCOUNT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

describe('auth.middleware — authenticate', () => {
  beforeEach(() => {
    mockGetByApiKeyHash.mockReset();
  });

  it('throws UnauthorizedError when x-api-key header is missing', async () => {
    await expect(authenticate({})).rejects.toThrow('missing api key');
  });

  it('throws UnauthorizedError when api key is not found in DDB', async () => {
    mockGetByApiKeyHash.mockResolvedValueOnce(null);
    await expect(authenticate({ 'x-api-key': 'bad-key' })).rejects.toThrow('invalid api key');
  });

  it('returns accountId and plan when tenant is found', async () => {
    mockGetByApiKeyHash.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    const result = await authenticate({ 'x-api-key': 'good-key' });
    expect(result.accountId).toBe(ACCOUNT_ID);
    expect(result.plan).toBe('free');
  });

  it('hashes the api key before lookup', async () => {
    mockGetByApiKeyHash.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    await authenticate({ 'x-api-key': 'test-key-123' });
    const hash = mockGetByApiKeyHash.mock.calls[0][0];
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toBe('test-key-123');
  });

  it('accepts X-API-KEY (uppercase) header', async () => {
    mockGetByApiKeyHash.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    const result = await authenticate({ 'X-API-KEY': 'good-key' });
    expect(result.accountId).toBe(ACCOUNT_ID);
  });

  it('prefers lowercase x-api-key when both headers present', async () => {
    mockGetByApiKeyHash.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    await authenticate({ 'x-api-key': 'lower-key', 'X-API-KEY': 'upper-key' });
    const hash1 = mockGetByApiKeyHash.mock.calls[0][0];

    mockGetByApiKeyHash.mockResolvedValueOnce({ accountId: ACCOUNT_ID, plan: 'free' });
    await authenticate({ 'x-api-key': 'lower-key' });
    const hash2 = mockGetByApiKeyHash.mock.calls[1][0];

    expect(hash1).toBe(hash2);
  });

  it('throws an UnauthorizedError instance (not generic Error)', async () => {
    try {
      await authenticate({});
    } catch (e) {
      expect(e.name).toBe('UnauthorizedError');
      expect(e.status).toBe(401);
      expect(e.code).toBe('UNAUTHORIZED');
      return;
    }
    throw new Error('expected error');
  });

  it('throws UnauthorizedError with status 401 for invalid key', async () => {
    mockGetByApiKeyHash.mockResolvedValueOnce(null);
    try {
      await authenticate({ 'x-api-key': 'wrong' });
    } catch (e) {
      expect(e.status).toBe(401);
      expect(e.code).toBe('UNAUTHORIZED');
      return;
    }
    throw new Error('expected error');
  });

  it('produces deterministic hash for same key', async () => {
    mockGetByApiKeyHash.mockResolvedValue({ accountId: ACCOUNT_ID, plan: 'free' });
    await authenticate({ 'x-api-key': 'same-key' });
    await authenticate({ 'x-api-key': 'same-key' });
    const h1 = mockGetByApiKeyHash.mock.calls[0][0];
    const h2 = mockGetByApiKeyHash.mock.calls[1][0];
    expect(h1).toBe(h2);
  });

  it('produces different hashes for different keys', async () => {
    mockGetByApiKeyHash.mockResolvedValue({ accountId: ACCOUNT_ID, plan: 'free' });
    await authenticate({ 'x-api-key': 'key-a' });
    await authenticate({ 'x-api-key': 'key-b' });
    const h1 = mockGetByApiKeyHash.mock.calls[0][0];
    const h2 = mockGetByApiKeyHash.mock.calls[1][0];
    expect(h1).not.toBe(h2);
  });
});

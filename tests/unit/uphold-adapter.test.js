import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetConfig = vi.hoisted(() => vi.fn());
const mockGetSecretJson = vi.hoisted(() => vi.fn());

vi.mock('../../src/lib/config.js', () => ({ getConfig: mockGetConfig }));
vi.mock('../../src/lib/secrets.js', () => ({ getSecretJson: mockGetSecretJson }));

import { upholdAdapter } from '../../src/adapters/uphold/client.js';
import { hmacSha256 } from '../../src/lib/crypto.js';

const MOCK_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:uphold';
const MOCK_CREDS = { secretKey: 'up-key', webhookSecret: 'up-webhook' };

const quoteInput = { fiatCurrency: 'USD', fiatAmount: 100, cryptoAsset: 'ETH' };

describe('uphold adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockReturnValue({ secretArns: { uphold: MOCK_ARN } });
    mockGetSecretJson.mockResolvedValue(MOCK_CREDS);
  });

  it('has name "uphold"', () => {
    expect(upholdAdapter.name).toBe('uphold');
  });

  describe('quote', () => {
    it('returns correct quote with uphold exchange', async () => {
      const result = await upholdAdapter.quote(quoteInput);
      expect(result.exchange).toBe('uphold');
      expect(result.cryptoAmount).toBe((100 * 0.9985).toString());
      expect(result.feeFiat).toBeCloseTo(100 * 0.015);
      expect(result.quoteId).toMatch(/^up_/);
    });

    it('throws UpstreamError when ARN is not configured', async () => {
      mockGetConfig.mockReturnValue({ secretArns: {} });
      await expect(upholdAdapter.quote(quoteInput)).rejects.toThrow('uphold');
    });

    it('passes through input fields', async () => {
      const input = { fiatCurrency: 'JPY', fiatAmount: 10000, cryptoAsset: 'USDC' };
      const result = await upholdAdapter.quote(input);
      expect(result.fiatCurrency).toBe('JPY');
      expect(result.fiatAmount).toBe(10000);
      expect(result.cryptoAsset).toBe('USDC');
    });
  });

  describe('executeBuy', () => {
    it('returns orderId with up_order_ prefix', async () => {
      const result = await upholdAdapter.executeBuy({ quoteId: 'q1', walletAddress: '0x1' });
      expect(result.orderId).toBe('up_order_q1');
    });

    it('throws UpstreamError when ARN is not configured', async () => {
      mockGetConfig.mockReturnValue({ secretArns: {} });
      await expect(
        upholdAdapter.executeBuy({ quoteId: 'q1', walletAddress: '0x1' }),
      ).rejects.toThrow('uphold');
    });
  });

  describe('verifyWebhook', () => {
    it('returns true for valid signature', async () => {
      const body = '{"event":"settled"}';
      const sig = hmacSha256(MOCK_CREDS.webhookSecret, body);
      const result = await upholdAdapter.verifyWebhook(body, { 'uphold-signature': sig });
      expect(result).toBe(true);
    });

    it('returns false when signature header is missing', async () => {
      const result = await upholdAdapter.verifyWebhook('body', {});
      expect(result).toBe(false);
    });

    it('returns false for invalid signature', async () => {
      const result = await upholdAdapter.verifyWebhook('body', { 'uphold-signature': 'nope' });
      expect(result).toBe(false);
    });
  });
});

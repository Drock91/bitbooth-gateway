import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetConfig = vi.hoisted(() => vi.fn());
const mockGetSecretJson = vi.hoisted(() => vi.fn());

vi.mock('../../src/lib/config.js', () => ({ getConfig: mockGetConfig }));
vi.mock('../../src/lib/secrets.js', () => ({ getSecretJson: mockGetSecretJson }));

import { moonpayAdapter } from '../../src/adapters/moonpay/client.js';
import { hmacSha256 } from '../../src/lib/crypto.js';

const MOCK_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:moonpay';
const MOCK_CREDS = { secretKey: 'mp-secret-key', webhookSecret: 'mp-webhook-secret' };

const quoteInput = {
  fiatCurrency: 'USD',
  fiatAmount: 100,
  cryptoAsset: 'ETH',
};

describe('moonpay adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockReturnValue({ secretArns: { moonpay: MOCK_ARN } });
    mockGetSecretJson.mockResolvedValue(MOCK_CREDS);
  });

  it('has name "moonpay"', () => {
    expect(moonpayAdapter.name).toBe('moonpay');
  });

  describe('quote', () => {
    it('returns a valid quote with all required fields', async () => {
      const result = await moonpayAdapter.quote(quoteInput);
      expect(result).toMatchObject({
        exchange: 'moonpay',
        fiatCurrency: 'USD',
        fiatAmount: 100,
        cryptoAsset: 'ETH',
      });
      expect(result.cryptoAmount).toBe((100 * 0.9995).toString());
      expect(result.feeFiat).toBeCloseTo(100 * 0.0149);
      expect(typeof result.expiresAt).toBe('number');
      expect(result.quoteId).toMatch(/^mp_/);
    });

    it('fetches credentials from correct ARN', async () => {
      await moonpayAdapter.quote(quoteInput);
      expect(mockGetSecretJson).toHaveBeenCalledWith(MOCK_ARN);
    });

    it('throws UpstreamError when ARN is not configured', async () => {
      mockGetConfig.mockReturnValue({ secretArns: {} });
      await expect(moonpayAdapter.quote(quoteInput)).rejects.toThrow('moonpay');
    });

    it('validates response through Zod schema', async () => {
      const result = await moonpayAdapter.quote(quoteInput);
      expect(typeof result.quoteId).toBe('string');
      expect(typeof result.cryptoAmount).toBe('string');
      expect(typeof result.feeFiat).toBe('number');
      expect(typeof result.expiresAt).toBe('number');
    });

    it('passes through fiatCurrency and cryptoAsset from input', async () => {
      const input = { fiatCurrency: 'EUR', fiatAmount: 50, cryptoAsset: 'USDC' };
      const result = await moonpayAdapter.quote(input);
      expect(result.fiatCurrency).toBe('EUR');
      expect(result.cryptoAsset).toBe('USDC');
      expect(result.fiatAmount).toBe(50);
    });
  });

  describe('executeBuy', () => {
    it('returns orderId with mp_order_ prefix', async () => {
      const result = await moonpayAdapter.executeBuy({ quoteId: 'q123', walletAddress: '0xabc' });
      expect(result.orderId).toBe('mp_order_q123');
    });

    it('fetches credentials', async () => {
      await moonpayAdapter.executeBuy({ quoteId: 'q1', walletAddress: '0x1' });
      expect(mockGetSecretJson).toHaveBeenCalledWith(MOCK_ARN);
    });

    it('throws UpstreamError when ARN is not configured', async () => {
      mockGetConfig.mockReturnValue({ secretArns: {} });
      await expect(
        moonpayAdapter.executeBuy({ quoteId: 'q1', walletAddress: '0x1' }),
      ).rejects.toThrow('moonpay');
    });
  });

  describe('verifyWebhook', () => {
    it('returns true for valid signature', async () => {
      const body = '{"event":"completed"}';
      const sig = hmacSha256(MOCK_CREDS.webhookSecret, body);
      const result = await moonpayAdapter.verifyWebhook(body, { 'moonpay-signature-v2': sig });
      expect(result).toBe(true);
    });

    it('returns false when signature header is missing', async () => {
      const result = await moonpayAdapter.verifyWebhook('body', {});
      expect(result).toBe(false);
    });

    it('returns false for invalid signature', async () => {
      const result = await moonpayAdapter.verifyWebhook('body', {
        'moonpay-signature-v2': 'bad-sig',
      });
      expect(result).toBe(false);
    });

    it('returns false for empty signature header', async () => {
      const result = await moonpayAdapter.verifyWebhook('body', { 'moonpay-signature-v2': '' });
      expect(result).toBe(false);
    });

    it('fetches webhookSecret from correct ARN', async () => {
      const body = 'test';
      const sig = hmacSha256(MOCK_CREDS.webhookSecret, body);
      await moonpayAdapter.verifyWebhook(body, { 'moonpay-signature-v2': sig });
      expect(mockGetSecretJson).toHaveBeenCalledWith(MOCK_ARN);
    });
  });
});

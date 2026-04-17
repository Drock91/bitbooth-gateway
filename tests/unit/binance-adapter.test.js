import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetConfig = vi.hoisted(() => vi.fn());
const mockGetSecretJson = vi.hoisted(() => vi.fn());

vi.mock('../../src/lib/config.js', () => ({ getConfig: mockGetConfig }));
vi.mock('../../src/lib/secrets.js', () => ({ getSecretJson: mockGetSecretJson }));

import { binanceAdapter } from '../../src/adapters/binance/client.js';
import { hmacSha256 } from '../../src/lib/crypto.js';

const MOCK_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:binance';
const MOCK_CREDS = { secretKey: 'bn-key', webhookSecret: 'bn-webhook', useUs: false };

const quoteInput = { fiatCurrency: 'USD', fiatAmount: 100, cryptoAsset: 'ETH' };

describe('binance adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockReturnValue({ secretArns: { binance: MOCK_ARN } });
    mockGetSecretJson.mockResolvedValue(MOCK_CREDS);
  });

  it('has name "binance"', () => {
    expect(binanceAdapter.name).toBe('binance');
  });

  describe('quote', () => {
    it('returns exchange "binance" when useUs is false', async () => {
      const result = await binanceAdapter.quote(quoteInput);
      expect(result.exchange).toBe('binance');
    });

    it('returns exchange "binance-us" when useUs is true', async () => {
      mockGetSecretJson.mockResolvedValue({ ...MOCK_CREDS, useUs: true });
      const result = await binanceAdapter.quote(quoteInput);
      expect(result.exchange).toBe('binance-us');
    });

    it('returns correct quote fields', async () => {
      const result = await binanceAdapter.quote(quoteInput);
      expect(result.cryptoAmount).toBe((100 * 0.9993).toString());
      expect(result.feeFiat).toBeCloseTo(100 * 0.001);
      expect(result.quoteId).toMatch(/^bn_/);
      expect(typeof result.expiresAt).toBe('number');
    });

    it('throws UpstreamError when ARN is not configured', async () => {
      mockGetConfig.mockReturnValue({ secretArns: {} });
      await expect(binanceAdapter.quote(quoteInput)).rejects.toThrow('binance');
    });

    it('passes through input fields', async () => {
      const input = { fiatCurrency: 'EUR', fiatAmount: 50, cryptoAsset: 'USDC' };
      const result = await binanceAdapter.quote(input);
      expect(result.fiatCurrency).toBe('EUR');
      expect(result.fiatAmount).toBe(50);
      expect(result.cryptoAsset).toBe('USDC');
    });
  });

  describe('executeBuy', () => {
    it('returns orderId with bn_order_ prefix', async () => {
      const result = await binanceAdapter.executeBuy({ quoteId: 'q1', walletAddress: '0x1' });
      expect(result.orderId).toBe('bn_order_q1');
    });

    it('throws UpstreamError when ARN is not configured', async () => {
      mockGetConfig.mockReturnValue({ secretArns: {} });
      await expect(
        binanceAdapter.executeBuy({ quoteId: 'q1', walletAddress: '0x1' }),
      ).rejects.toThrow('binance');
    });
  });

  describe('verifyWebhook', () => {
    it('returns true for valid signature', async () => {
      const body = '{"event":"done"}';
      const sig = hmacSha256(MOCK_CREDS.webhookSecret, body);
      const result = await binanceAdapter.verifyWebhook(body, { 'binance-signature': sig });
      expect(result).toBe(true);
    });

    it('returns false when signature header is missing', async () => {
      const result = await binanceAdapter.verifyWebhook('body', {});
      expect(result).toBe(false);
    });

    it('returns false for invalid signature', async () => {
      const result = await binanceAdapter.verifyWebhook('body', { 'binance-signature': 'bad' });
      expect(result).toBe(false);
    });
  });
});

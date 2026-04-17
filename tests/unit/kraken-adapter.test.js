import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetConfig = vi.hoisted(() => vi.fn());
const mockGetSecretJson = vi.hoisted(() => vi.fn());

vi.mock('../../src/lib/config.js', () => ({ getConfig: mockGetConfig }));
vi.mock('../../src/lib/secrets.js', () => ({ getSecretJson: mockGetSecretJson }));

import { krakenAdapter } from '../../src/adapters/kraken/client.js';
import { hmacSha256 } from '../../src/lib/crypto.js';

const MOCK_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:kraken';
const MOCK_CREDS = { secretKey: 'kr-key', webhookSecret: 'kr-webhook' };

const quoteInput = { fiatCurrency: 'USD', fiatAmount: 100, cryptoAsset: 'ETH' };

describe('kraken adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockReturnValue({ secretArns: { kraken: MOCK_ARN } });
    mockGetSecretJson.mockResolvedValue(MOCK_CREDS);
  });

  it('has name "kraken"', () => {
    expect(krakenAdapter.name).toBe('kraken');
  });

  describe('quote', () => {
    it('returns correct quote with kraken exchange', async () => {
      const result = await krakenAdapter.quote(quoteInput);
      expect(result.exchange).toBe('kraken');
      expect(result.cryptoAmount).toBe((100 * 0.9992).toString());
      expect(result.feeFiat).toBeCloseTo(100 * 0.0026);
      expect(result.quoteId).toMatch(/^kr_/);
    });

    it('throws UpstreamError when ARN is not configured', async () => {
      mockGetConfig.mockReturnValue({ secretArns: {} });
      await expect(krakenAdapter.quote(quoteInput)).rejects.toThrow('kraken');
    });

    it('passes through input fields', async () => {
      const input = { fiatCurrency: 'GBP', fiatAmount: 25, cryptoAsset: 'BTC' };
      const result = await krakenAdapter.quote(input);
      expect(result.fiatCurrency).toBe('GBP');
      expect(result.fiatAmount).toBe(25);
      expect(result.cryptoAsset).toBe('BTC');
    });
  });

  describe('executeBuy', () => {
    it('returns orderId with kr_order_ prefix', async () => {
      const result = await krakenAdapter.executeBuy({ quoteId: 'q1', walletAddress: '0x1' });
      expect(result.orderId).toBe('kr_order_q1');
    });

    it('throws UpstreamError when ARN is not configured', async () => {
      mockGetConfig.mockReturnValue({ secretArns: {} });
      await expect(
        krakenAdapter.executeBuy({ quoteId: 'q1', walletAddress: '0x1' }),
      ).rejects.toThrow('kraken');
    });
  });

  describe('verifyWebhook', () => {
    it('returns true for valid signature', async () => {
      const body = '{"status":"ok"}';
      const sig = hmacSha256(MOCK_CREDS.webhookSecret, body);
      const result = await krakenAdapter.verifyWebhook(body, { 'kraken-signature': sig });
      expect(result).toBe(true);
    });

    it('returns false when signature header is missing', async () => {
      const result = await krakenAdapter.verifyWebhook('body', {});
      expect(result).toBe(false);
    });

    it('returns false for invalid signature', async () => {
      const result = await krakenAdapter.verifyWebhook('body', { 'kraken-signature': 'wrong' });
      expect(result).toBe(false);
    });
  });
});

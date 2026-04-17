import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetConfig = vi.hoisted(() => vi.fn());
const mockGetSecretJson = vi.hoisted(() => vi.fn());

vi.mock('../../src/lib/config.js', () => ({ getConfig: mockGetConfig }));
vi.mock('../../src/lib/secrets.js', () => ({ getSecretJson: mockGetSecretJson }));

import { coinbaseAdapter } from '../../src/adapters/coinbase/client.js';
import { hmacSha256 } from '../../src/lib/crypto.js';

const MOCK_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:coinbase';
const MOCK_CREDS = { secretKey: 'cb-secret-key', webhookSecret: 'cb-webhook-secret' };

const quoteInput = {
  fiatCurrency: 'USD',
  fiatAmount: 200,
  cryptoAsset: 'ETH',
};

describe('coinbase adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockReturnValue({ secretArns: { coinbase: MOCK_ARN } });
    mockGetSecretJson.mockResolvedValue(MOCK_CREDS);
  });

  it('has name "coinbase"', () => {
    expect(coinbaseAdapter.name).toBe('coinbase');
  });

  describe('quote', () => {
    it('returns a valid quote with all required fields', async () => {
      const result = await coinbaseAdapter.quote(quoteInput);
      expect(result).toMatchObject({
        exchange: 'coinbase',
        fiatCurrency: 'USD',
        fiatAmount: 200,
        cryptoAsset: 'ETH',
      });
      expect(result.cryptoAmount).toBe((200 * 0.999).toString());
      expect(result.feeFiat).toBeCloseTo(200 * 0.0099);
      expect(typeof result.expiresAt).toBe('number');
      expect(result.quoteId).toMatch(/^cb_/);
    });

    it('fetches credentials from correct ARN', async () => {
      await coinbaseAdapter.quote(quoteInput);
      expect(mockGetSecretJson).toHaveBeenCalledWith(MOCK_ARN);
    });

    it('throws UpstreamError when ARN is not configured', async () => {
      mockGetConfig.mockReturnValue({ secretArns: {} });
      await expect(coinbaseAdapter.quote(quoteInput)).rejects.toThrow('coinbase');
    });

    it('passes through fiatCurrency and cryptoAsset from input', async () => {
      const input = { fiatCurrency: 'GBP', fiatAmount: 75, cryptoAsset: 'USDC' };
      const result = await coinbaseAdapter.quote(input);
      expect(result.fiatCurrency).toBe('GBP');
      expect(result.cryptoAsset).toBe('USDC');
      expect(result.fiatAmount).toBe(75);
    });

    it('returns string cryptoAmount', async () => {
      const result = await coinbaseAdapter.quote(quoteInput);
      expect(typeof result.cryptoAmount).toBe('string');
    });
  });

  describe('executeBuy', () => {
    it('returns orderId with cb_order_ prefix', async () => {
      const result = await coinbaseAdapter.executeBuy({ quoteId: 'q456', walletAddress: '0xdef' });
      expect(result.orderId).toBe('cb_order_q456');
    });

    it('fetches credentials', async () => {
      await coinbaseAdapter.executeBuy({ quoteId: 'q1', walletAddress: '0x1' });
      expect(mockGetSecretJson).toHaveBeenCalledWith(MOCK_ARN);
    });

    it('throws UpstreamError when ARN is not configured', async () => {
      mockGetConfig.mockReturnValue({ secretArns: {} });
      await expect(
        coinbaseAdapter.executeBuy({ quoteId: 'q1', walletAddress: '0x1' }),
      ).rejects.toThrow('coinbase');
    });
  });

  describe('verifyWebhook', () => {
    it('returns true for valid signature', async () => {
      const body = '{"event":"payment_confirmed"}';
      const sig = hmacSha256(MOCK_CREDS.webhookSecret, body);
      const result = await coinbaseAdapter.verifyWebhook(body, { 'cb-signature': sig });
      expect(result).toBe(true);
    });

    it('returns false when signature header is missing', async () => {
      const result = await coinbaseAdapter.verifyWebhook('body', {});
      expect(result).toBe(false);
    });

    it('returns false for invalid signature', async () => {
      const result = await coinbaseAdapter.verifyWebhook('body', { 'cb-signature': 'wrong' });
      expect(result).toBe(false);
    });

    it('returns false for empty signature header', async () => {
      const result = await coinbaseAdapter.verifyWebhook('body', { 'cb-signature': '' });
      expect(result).toBe(false);
    });

    it('fetches webhookSecret from correct ARN', async () => {
      const body = 'test';
      const sig = hmacSha256(MOCK_CREDS.webhookSecret, body);
      await coinbaseAdapter.verifyWebhook(body, { 'cb-signature': sig });
      expect(mockGetSecretJson).toHaveBeenCalledWith(MOCK_ARN);
    });
  });
});

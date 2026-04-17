import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetAdapter = vi.hoisted(() => vi.fn());
const mockBestQuote = vi.hoisted(() => vi.fn());

vi.mock('../../src/services/routing.service.js', () => ({
  getAdapter: mockGetAdapter,
  bestQuote: mockBestQuote,
}));

import { quoteService } from '../../src/services/quote.service.js';

function fakeQuote(exchange) {
  return {
    exchange,
    fiatCurrency: 'USD',
    fiatAmount: 100,
    cryptoAmount: '99.5',
    cryptoAsset: 'USDC',
    feeFiat: 0.99,
    expiresAt: Math.floor(Date.now() / 1000) + 60,
    quoteId: `${exchange}_q1`,
  };
}

describe('quoteService.getBest', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('when input.exchange is specified', () => {
    it('calls getAdapter with the exchange name and returns its quote', async () => {
      const adapterMock = { quote: vi.fn().mockResolvedValue(fakeQuote('moonpay')) };
      mockGetAdapter.mockReturnValue(adapterMock);

      const result = await quoteService.getBest({
        exchange: 'moonpay',
        fiatCurrency: 'USD',
        fiatAmount: 100,
        cryptoAsset: 'USDC',
      });

      expect(mockGetAdapter).toHaveBeenCalledWith('moonpay');
      expect(adapterMock.quote).toHaveBeenCalledWith({
        fiatCurrency: 'USD',
        fiatAmount: 100,
        cryptoAsset: 'USDC',
      });
      expect(result.exchange).toBe('moonpay');
      expect(mockBestQuote).not.toHaveBeenCalled();
    });

    it('propagates adapter errors', async () => {
      const adapterMock = { quote: vi.fn().mockRejectedValue(new Error('upstream fail')) };
      mockGetAdapter.mockReturnValue(adapterMock);

      await expect(
        quoteService.getBest({
          exchange: 'moonpay',
          fiatCurrency: 'USD',
          fiatAmount: 100,
          cryptoAsset: 'USDC',
        }),
      ).rejects.toThrow('upstream fail');
    });

    it('passes only fiatCurrency, fiatAmount, cryptoAsset to adapter (no exchange leak)', async () => {
      const adapterMock = { quote: vi.fn().mockResolvedValue(fakeQuote('kraken')) };
      mockGetAdapter.mockReturnValue(adapterMock);

      await quoteService.getBest({
        exchange: 'kraken',
        fiatCurrency: 'EUR',
        fiatAmount: 50,
        cryptoAsset: 'ETH',
      });

      expect(adapterMock.quote).toHaveBeenCalledWith({
        fiatCurrency: 'EUR',
        fiatAmount: 50,
        cryptoAsset: 'ETH',
      });
    });
  });

  describe('when input.exchange is not specified', () => {
    it('calls bestQuote and returns the result', async () => {
      mockBestQuote.mockResolvedValue(fakeQuote('coinbase'));

      const result = await quoteService.getBest({
        fiatCurrency: 'USD',
        fiatAmount: 200,
        cryptoAsset: 'USDC',
      });

      expect(mockBestQuote).toHaveBeenCalledWith({
        fiatCurrency: 'USD',
        fiatAmount: 200,
        cryptoAsset: 'USDC',
      });
      expect(result.exchange).toBe('coinbase');
      expect(mockGetAdapter).not.toHaveBeenCalled();
    });

    it('propagates bestQuote UpstreamError', async () => {
      const { UpstreamError } = await import('../../src/lib/errors.js');
      mockBestQuote.mockRejectedValue(
        new UpstreamError('exchange', { reason: 'no exchange returned a quote' }),
      );

      await expect(
        quoteService.getBest({ fiatCurrency: 'USD', fiatAmount: 100, cryptoAsset: 'USDC' }),
      ).rejects.toThrow(UpstreamError);
    });

    it('treats undefined exchange same as missing', async () => {
      mockBestQuote.mockResolvedValue(fakeQuote('binance'));

      const result = await quoteService.getBest({
        exchange: undefined,
        fiatCurrency: 'USD',
        fiatAmount: 100,
        cryptoAsset: 'USDC',
      });

      expect(mockBestQuote).toHaveBeenCalled();
      expect(mockGetAdapter).not.toHaveBeenCalled();
      expect(result.exchange).toBe('binance');
    });

    it('treats empty string exchange as falsy — calls bestQuote', async () => {
      mockBestQuote.mockResolvedValue(fakeQuote('uphold'));

      const result = await quoteService.getBest({
        exchange: '',
        fiatCurrency: 'USD',
        fiatAmount: 100,
        cryptoAsset: 'USDC',
      });

      expect(mockBestQuote).toHaveBeenCalled();
      expect(result.exchange).toBe('uphold');
    });
  });
});

import { z } from 'zod';

export const SupportedExchange = z.enum(['moonpay', 'coinbase', 'kraken', 'binance', 'uphold']);

export const QuoteRequest = z.object({
  fiatCurrency: z.enum(['USD', 'EUR', 'GBP']),
  fiatAmount: z.number().positive().max(50000),
  cryptoAsset: z.enum(['USDC', 'XRP', 'ETH']),
  exchange: SupportedExchange.optional(),
});

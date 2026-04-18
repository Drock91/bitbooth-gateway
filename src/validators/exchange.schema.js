import { z } from 'zod';

// Stub adapters deleted. SupportedExchange is now a generic string
// until a real exchange adapter (e.g. Moonpay) ships.
export const SupportedExchange = z.string().min(1);

export const QuoteRequest = z.object({
  fiatCurrency: z.enum(['USD', 'EUR', 'GBP']),
  fiatAmount: z.number().positive().max(50000),
  cryptoAsset: z.enum(['USDC', 'XRP', 'ETH']),
  exchange: SupportedExchange.optional(),
});
